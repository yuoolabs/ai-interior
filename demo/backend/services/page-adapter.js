const { buildAdapterConfigFromEnv, validateAdapterConfig } = require("./page-adapter-config");

class PageAdapter {
  constructor(options = {}) {
    this.mode = options.mode || process.env.MICROPAGE_ADAPTER_MODE || "mock";
    this.apiBaseUrl = options.apiBaseUrl || process.env.MICROPAGE_API_BASE || "";
    this.apiToken = options.apiToken || process.env.MICROPAGE_API_TOKEN || "";
    this.healthPath = options.healthPath || process.env.MICROPAGE_API_HEALTH_PATH || "/health";
    this.uiFallbackRunner = options.uiFallbackRunner || null;
    this.config = options.config || buildAdapterConfigFromEnv();
    this.configValidation = validateAdapterConfig(this.config);
  }

  async preflight(options = {}) {
    const strict = options.strict === true;
    const summary = {
      mode: this.mode,
      apiBaseSet: Boolean(this.apiBaseUrl),
      apiTokenSet: Boolean(this.apiToken),
      configValid: this.configValidation.valid,
      configErrors: this.configValidation.errors,
      checks: []
    };

    if (this.mode !== "real") {
      summary.checks.push({
        name: "mode_check",
        ok: true,
        message: `当前模式为 ${this.mode}，未执行真实接口探测`
      });
      return {
        ok: true,
        ...summary
      };
    }

    if (!summary.apiBaseSet || !summary.apiTokenSet) {
      summary.checks.push({
        name: "credentials_check",
        ok: false,
        message: "real 模式需要 MICROPAGE_API_BASE 与 MICROPAGE_API_TOKEN"
      });
      return {
        ok: false,
        ...summary
      };
    }

    if (!summary.configValid) {
      summary.checks.push({
        name: "config_check",
        ok: false,
        message: `适配器配置不合法: ${summary.configErrors.join(",")}`
      });
      return {
        ok: false,
        ...summary
      };
    }

    const pathCheck = this.checkActionPathResolvability();
    summary.checks.push(pathCheck);

    const connectivity = await this.checkConnectivity().catch((error) => ({
      name: "connectivity_check",
      ok: false,
      message: `连通性检查失败: ${sanitizeError(error.message || "unknown_error")}`
    }));
    summary.checks.push(connectivity);

    const allPass = summary.checks.every((item) => item.ok);
    if (!allPass && strict) {
      return {
        ok: false,
        ...summary
      };
    }

    return {
      ok: allPass,
      ...summary
    };
  }

  async uploadMaterial({ filePath, title, prompt, quality }) {
    if (this.mode === "real" && this.apiBaseUrl && this.apiToken) {
      if (!this.configValidation.valid) {
        throw new Error(`adapter_config_invalid:${this.configValidation.errors.join(",")}`);
      }
      try {
        const rule = this.config.uploadMaterial;
        const response = await this.request(
          rule.method || "POST",
          resolvePath(rule.path, { input: { filePath, title, prompt, quality } }),
          typeof rule.payload === "function" ? rule.payload({ input: { filePath, title, prompt, quality } }) : { title, prompt, filePath, quality }
        );
        const parsed = typeof rule.parse === "function" ? rule.parse(response) : {};
        return {
          status: parsed.status || "uploaded",
          statusLabel: parsed.statusLabel || "已上传素材库",
          materialId: parsed.materialId ?? response.material_id ?? response.id ?? null,
          integrationHint: parsed.integrationHint || "素材已通过 API 入库"
        };
      } catch {
        return {
          status: "pending_material_upload",
          statusLabel: "上传失败，待人工确认",
          materialId: null,
          integrationHint: "已触发 API 上传但失败，可重试"
        };
      }
    }

    return {
      status: "uploaded",
      statusLabel: "已上传素材库(模拟)",
      materialId: `mat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      integrationHint: "当前为模拟素材入库，可切换 real 模式对接真实素材服务"
    };
  }

  async executeActionGraph({ run, draft, assets, emit }) {
    const nodes = draft?.execution?.actionGraph?.nodes || [];
    if (!nodes.length) {
      throw new Error("action_graph_empty");
    }

    if (this.mode === "ui_only") {
      return this.runUiFallback({ run, draft, assets, emit, reason: "ui_only_mode" });
    }

    try {
      return await this.executeByApi({ run, nodes, emit });
    } catch (error) {
      if (!this.uiFallbackRunner) throw error;
      emit({
        title: "API 执行失败，切换 UI 兜底",
        message: error.message || "api_execution_failed",
        status: "degraded",
        kind: "warning"
      });
      return this.runUiFallback({ run, draft, assets, emit, reason: error.message || "api_failed" });
    }
  }

  async executeByApi({ run, nodes, emit }) {
    const runtime = {
      pageId: null,
      completed: []
    };

    for (const node of nodes) {
      emit({ title: node.title, message: "执行中", status: "running", kind: "action", details: node });
      const result = await this.executeNode({ run, node, runtime, assets: run.context?.draft?.generatedAssets || [] });
      runtime.completed.push({ nodeId: node.id, result });
      emit({ title: node.title, message: "执行完成", status: "done", kind: "action", details: result });
    }

    return {
      channel: this.mode === "real" ? "api" : "api_mock",
      pageId: runtime.pageId || `page_${Date.now()}`,
      completed: runtime.completed
    };
  }

  async executeNode({ run, node, runtime, assets = [] }) {
    if (this.mode !== "real") {
      await delay(150);
      if (node.action === "create_page") runtime.pageId = runtime.pageId || `page_${Date.now()}`;
      return { ok: true, mock: true, action: node.action };
    }

    if (!this.apiBaseUrl || !this.apiToken) {
      throw new Error("missing_api_config");
    }
    if (!this.configValidation.valid) {
      throw new Error(`adapter_config_invalid:${this.configValidation.errors.join(",")}`);
    }

    const actionRule = this.config.actions?.[node.action];
    if (actionRule) {
      const endpoint = resolvePath(actionRule.path, { run, node, runtime, assets });
      const payload = typeof actionRule.payload === "function"
        ? actionRule.payload({ run, node, runtime, assets })
        : {};
      const response = await this.request(
        actionRule.method || "POST",
        endpoint,
        payload,
        run.id,
        node.id
      );
      const parsed = typeof actionRule.parse === "function" ? actionRule.parse(response) : response;
      if (parsed?.pageId) runtime.pageId = parsed.pageId;
      if (!runtime.pageId && (response?.page_id || response?.id) && node.action === "create_page") {
        runtime.pageId = response.page_id || response.id;
      }
      return parsed || response;
    }

    await delay(100);
    return { ok: true, action: node.action };
  }

  async runUiFallback({ run, draft, assets, emit, reason }) {
    if (!this.uiFallbackRunner) {
      throw new Error(`ui_fallback_unavailable:${reason}`);
    }
    return this.uiFallbackRunner({ run, draft, assets, emit, reason });
  }

  async publish({ pageId, runId }) {
    if (this.mode === "real") {
      const actionRule = this.config.actions?.publish_page;
      if (actionRule) {
        const endpoint = resolvePath(actionRule.path, { runtime: { pageId } });
        const payload = typeof actionRule.payload === "function"
          ? actionRule.payload({ runtime: { pageId } })
          : {};
        return this.request(actionRule.method || "POST", endpoint, payload, runId, "manual_publish");
      }
      return this.request("POST", `/pages/${pageId}/publish`, {}, runId, "manual_publish");
    }

    return {
      ok: true,
      pageId,
      publishedAt: new Date().toISOString(),
      mode: "mock"
    };
  }

  async request(method, endpoint, body, runId = "", actionId = "") {
    const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiToken}`,
        "Idempotency-Key": runId && actionId ? `${runId}:${actionId}` : `req_${Date.now()}`
      },
      body: method === "GET" ? undefined : JSON.stringify(body || {})
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`api_${method}_${endpoint}:${response.status}:${text.slice(0, 180)}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return { ok: true };
    }
    return response.json();
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePath(pathDef, context) {
  if (typeof pathDef === "function") {
    return pathDef(context);
  }
  return pathDef;
}

PageAdapter.prototype.checkActionPathResolvability = function checkActionPathResolvability() {
  const sample = {
    run: {
      id: "preflight_run",
      context: {
        pageName: "preflight-page",
        draft: {
          execution: { page_name: "preflight-page" },
          parsed: { page_goal: "卖货转化" }
        }
      }
    },
    node: {
      payload: {
        pageName: "preflight-page",
        component: "banner",
        module: "banner",
        displayName: "图文广告"
      }
    },
    runtime: { pageId: "preflight_page_id" },
    assets: [{ material_id: "mat_preflight" }]
  };

  const unresolved = [];
  Object.entries(this.config.actions || {}).forEach(([action, rule]) => {
    const endpoint = resolvePath(rule.path, sample);
    const text = String(endpoint || "");
    if (!text || text.includes("{{") || text.includes("undefined")) {
      unresolved.push(`${action}:${text || "empty"}`);
    }
  });

  if (unresolved.length) {
    return {
      name: "path_resolve_check",
      ok: false,
      message: `以下动作路径无法解析: ${unresolved.join(" | ")}`
    };
  }

  return {
    name: "path_resolve_check",
    ok: true,
    message: "动作路径解析通过"
  };
};

PageAdapter.prototype.checkConnectivity = async function checkConnectivity() {
  const response = await fetch(`${this.apiBaseUrl}${this.healthPath}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${this.apiToken}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      name: "connectivity_check",
      ok: false,
      message: `健康检查失败: status=${response.status}, body=${sanitizeError(text.slice(0, 180))}`
    };
  }

  return {
    name: "connectivity_check",
    ok: true,
    message: "健康检查通过"
  };
};

function sanitizeError(message) {
  return String(message || "")
    .replace(/Bearer\\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .replace(/(token|authorization)\\s*[:=]\\s*[^\\s,;]+/gi, "$1=***");
}

module.exports = {
  PageAdapter
};
