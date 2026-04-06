class Orchestrator {
  constructor({ intentService, designService, assetPipeline, stateMachine, runStore, auditService, pageAdapter, modelGateway }) {
    this.intentService = intentService;
    this.designService = designService;
    this.assetPipeline = assetPipeline;
    this.stateMachine = stateMachine;
    this.runStore = runStore;
    this.auditService = auditService;
    this.pageAdapter = pageAdapter;
    this.modelGateway = modelGateway;
    this.designs = new Map();
  }

  async parseIntent(input) {
    const parsed = await this.intentService.parse(input);
    if (input?.require_model && parsed?.model_fallback) {
      throw new Error(`model_required_but_fallback:${parsed.model_fallback_reason || "intent_parse_fallback"}`);
    }
    const trace = this.auditService.record({ type: "intent_parse", details: { parsed }, actor: "orchestrator" });
    return {
      parsed,
      trace_id: trace.traceId
    };
  }

  async generateDesign(input) {
    const intent = input.intent || (await this.intentService.parse(input));
    if (input?.require_model && intent?.model_fallback) {
      throw new Error(`model_required_but_fallback:${intent.model_fallback_reason || "intent_parse_fallback"}`);
    }
    const draft = await this.designService.generate(intent);
    if (input?.require_model) {
      const blueprintFallback = Boolean(draft?.designBlueprint?.modelFallback);
      const copyFallback = Boolean(draft?.copyDraft?.modelFallback);
      if (blueprintFallback || copyFallback) {
        const reason = draft?.designBlueprint?.modelFallbackReason || draft?.copyDraft?.modelFallbackReason || "design_generate_fallback";
        throw new Error(`model_required_but_fallback:${reason}`);
      }
    }
    const designId = `design_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.designs.set(designId, {
      id: designId,
      draft,
      intent,
      createdAt: new Date().toISOString()
    });

    const trace = this.auditService.record({ type: "design_generate", details: { designId }, actor: "orchestrator" });

    return {
      design_id: designId,
      ...draft,
      trace_id: trace.traceId
    };
  }

  async generateAssetsAndUpload(input) {
    const design = this.resolveDesign(input);
    if (!design) {
      throw new Error("design_not_found");
    }

    const assets = await this.assetPipeline.generateAndUpload({
      parsed: design.draft.parsed,
      componentPlan: design.draft.componentPlan,
      referenceAnalysis: design.draft.parsed.reference_analysis
    });

    this.designs.set(design.id, {
      ...design,
      draft: {
        ...design.draft,
        generatedAssets: assets
      }
    });

    const trace = this.auditService.record({ type: "assets_generate_upload", details: { designId: design.id, count: assets.length }, actor: "asset_pipeline" });

    return {
      design_id: design.id,
      assets,
      trace_id: trace.traceId
    };
  }

  async executePage(input) {
    const sourceRun = input.resume_run_id ? this.runStore.getRun(input.resume_run_id) : null;
    if (input.resume_run_id && !sourceRun) {
      throw new Error("resume_run_not_found");
    }

    const normalizedInput = normalizeExecuteInput(input, sourceRun);
    const design = this.resolveDesign(normalizedInput);
    if (!design) {
      throw new Error("design_not_found");
    }

    const mode = this.pageAdapter.mode || "mock";
    if (mode === "real") {
      const preflight = await this.pageAdapter.preflight({ strict: true });
      this.auditService.record({
        type: "preflight",
        actor: "orchestrator",
        details: preflight
      });
      if (!preflight.ok) {
        throw new Error(`preflight_blocked:${(preflight.checks || []).map((item) => item.message).join(" | ")}`);
      }
    }

    const run = this.runStore.createRun({
      designId: design.id,
      pageName: design.draft.execution.page_name,
      draft: design.draft,
      autoPublish: normalizedInput.auto_publish !== false,
      authLevel: normalizedInput.auth_level || "service_account",
      tenantId: normalizedInput.tenant_id || "default",
      resumeFromRunId: sourceRun?.id || null
    });

    const appendEvent = (event) => this.runStore.appendEvent(run.id, event);
    const patchRun = (patch) => this.runStore.updateRun(run.id, patch);

    this.auditService.record({ runId: run.id, type: "run_created", actor: "orchestrator", details: { designId: design.id } });
    if (sourceRun) {
      appendEvent({
        stage: "manual_intervention",
        title: "断点续跑",
        message: `基于任务 ${sourceRun.id} 重新执行`,
        status: "running",
        kind: "insight",
        details: { sourceRunId: sourceRun.id }
      });
      this.runStore.appendLog(run.id, `断点续跑来源: ${sourceRun.id}`);
      this.auditService.record({
        runId: run.id,
        type: "run_resumed",
        actor: "orchestrator",
        details: { sourceRunId: sourceRun.id }
      });
    }

    this.stateMachine
      .execute({
        run,
        draft: design.draft,
        assets: design.draft.generatedAssets || [],
        runContext: {
          autoPublish: normalizedInput.auto_publish !== false,
          authLevel: normalizedInput.auth_level || "service_account",
          tenantId: normalizedInput.tenant_id || "default"
        },
        emit: (event) => {
          const normalized = appendEvent(event);
          if (event.message) {
            this.runStore.appendLog(run.id, `${event.title || "动作"}: ${event.message}`);
          }
          return normalized;
        },
        patchRun
      })
      .then((result) => {
        this.auditService.record({ runId: run.id, type: "run_completed", actor: "orchestrator", details: result });
      })
      .catch((error) => {
        patchRun({ state: "failed", message: error.message || "执行失败", currentStep: "已停止" });
        appendEvent({
          stage: "runtime_execution",
          title: "自动执行失败",
          message: error.message || "unknown_error",
          status: "failed",
          kind: "warning"
        });
        this.auditService.record({ runId: run.id, type: "run_failed", actor: "orchestrator", details: { error: error.message || "unknown" } });
      });

    return {
      run_id: run.id,
      state: run.state,
      message: "已开始自动执行",
      currentStep: run.currentStep,
      events: run.events,
      resume_from_run_id: sourceRun?.id || null
    };
  }

  async autoBuild(input = {}) {
    const intentResult = await this.parseIntent(input);
    const designResult = await this.generateDesign({
      intent: intentResult.parsed,
      require_model: input.require_model
    });
    const assetsResult = await this.generateAssetsAndUpload({
      design_id: designResult.design_id
    });
    const executeResult = await this.executePage({
      design_id: designResult.design_id,
      auto_publish: input.auto_publish !== false,
      auth_level: input.auth_level || "service_account",
      tenant_id: input.tenant_id || "default"
    });

    const designDraft = {
      design_id: designResult.design_id,
      parsed: designResult.parsed,
      template: designResult.template,
      pageStructure: designResult.pageStructure,
      componentPlan: designResult.componentPlan,
      validation: designResult.validation,
      diff: designResult.diff,
      execution: designResult.execution,
      copyDraft: designResult.copyDraft,
      designBlueprint: designResult.designBlueprint,
      generatedAssets: assetsResult.assets || []
    };

    return {
      run_id: executeResult.run_id,
      state: executeResult.state,
      design_id: designResult.design_id,
      parsed: intentResult.parsed,
      execute: executeResult,
      design_draft: designDraft,
      design: {
        template: designResult.template,
        pageStructure: designResult.pageStructure,
        componentPlan: designResult.componentPlan,
        copyDraft: designResult.copyDraft,
        designBlueprint: designResult.designBlueprint
      },
      assets: assetsResult.assets || [],
      trace_ids: {
        intent: intentResult.trace_id,
        design: designResult.trace_id,
        assets: assetsResult.trace_id
      }
    };
  }

  async takeoverRun(input = {}) {
    const runId = input.run_id;
    const run = runId ? this.runStore.getRun(runId) : null;
    if (!run) {
      throw new Error("run_not_found");
    }

    const reason = input.reason || "已切换人工接管";
    const operator = input.operator || "manual_operator";

    this.runStore.updateRun(run.id, {
      state: "manual_review",
      currentStep: "人工接管",
      message: reason
    });
    this.runStore.appendEvent(run.id, {
      stage: "manual_intervention",
      title: "人工接管",
      message: reason,
      status: "degraded",
      kind: "warning",
      details: { operator }
    });
    this.runStore.appendLog(run.id, `人工接管(${operator}): ${reason}`);
    this.auditService.record({
      runId: run.id,
      type: "manual_takeover",
      actor: operator,
      details: { reason, operator }
    });

    return this.getRun(run.id);
  }

  async resumeRun(input = {}) {
    const source = input.run_id ? this.runStore.getRun(input.run_id) : null;
    if (!source) {
      throw new Error("run_not_found");
    }

    const designId = input.design_id || source.context?.designId;
    if (!designId && !source.context?.draft) {
      throw new Error("resume_design_missing");
    }

    return this.executePage({
      design_id: designId,
      draft: source.context?.draft,
      generated_assets: source.context?.draft?.generatedAssets || [],
      auto_publish: input.auto_publish ?? source.context?.autoPublish ?? true,
      auth_level: input.auth_level || source.context?.authLevel || "service_account",
      tenant_id: input.tenant_id || source.context?.tenantId || "default",
      resume_run_id: source.id
    });
  }

  async publishPage(input) {
    const run = input.run_id ? this.runStore.getRun(input.run_id) : null;
    const pageId = input.page_id || run?.outputs?.pageId;
    if (!pageId) {
      throw new Error("page_id_missing");
    }

    const result = await this.pageAdapter.publish({ pageId, runId: run?.id || "manual" });
    this.auditService.record({ runId: run?.id || null, type: "manual_publish", details: result, actor: "orchestrator" });
    return {
      page_id: pageId,
      result
    };
  }

  async systemPreflight(input = {}) {
    const adapter = await this.pageAdapter.preflight(input);
    const model = this.modelGateway?.preflight
      ? await this.modelGateway.preflight({ strict: input.strict === true })
      : {
          ok: true,
          provider: "unknown",
          model: "",
          baseUrl: "",
          hasApiKey: false,
          checks: []
        };

    return {
      ...adapter,
      model,
      ok: Boolean(adapter.ok) && Boolean(model.ok)
    };
  }

  async systemModelPreflight(input = {}) {
    if (!this.modelGateway?.preflight) {
      return {
        ok: false,
        provider: "unknown",
        model: "",
        baseUrl: "",
        hasApiKey: false,
        checks: [
          {
            name: "gateway_check",
            ok: false,
            message: "model_gateway_unavailable"
          }
        ]
      };
    }
    return this.modelGateway.preflight(input);
  }

  getRolloutStatus() {
    return this.stateMachine?.rolloutPolicy?.getStatus?.() || {
      mode: this.pageAdapter.mode || "unknown",
      realAutoPublishEnabled: false,
      allowlist: []
    };
  }

  getRun(runId) {
    const run = this.runStore.getRun(runId);
    if (!run) return null;
    const audit = this.auditService.listByRun(run.id);
    const failureReason = deriveFailureReason(run);

    return {
      run_id: run.id,
      id: run.id,
      state: run.state,
      message: run.message,
      currentStep: run.currentStep,
      retries: run.retries,
      logs: run.logs,
      events: run.events,
      outputs: run.outputs,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      audit,
      audit_trace_id: audit.length ? audit[audit.length - 1].traceId : null,
      failure_reason: failureReason,
      retryable: isRetryable(run),
      retry_suggestions: deriveRetrySuggestions(run, failureReason),
      resume_from_run_id: run.context?.resumeFromRunId || null
    };
  }

  resolveDesign(input) {
    if (input.design_id && this.designs.has(input.design_id)) {
      return this.designs.get(input.design_id);
    }

    if (input.draft) {
      const designId = `design_inline_${Date.now()}`;
      const draft = {
        ...input.draft,
        generatedAssets: input.generated_assets || input.draft.generatedAssets || []
      };
      const stored = {
        id: designId,
        draft,
        intent: input.intent || draft.parsed,
        createdAt: new Date().toISOString()
      };
      this.designs.set(designId, stored);
      return stored;
    }

    return null;
  }
}

function normalizeExecuteInput(input = {}, sourceRun) {
  if (!sourceRun) return input;
  return {
    ...input,
    design_id: input.design_id || sourceRun.context?.designId,
    draft: input.draft || sourceRun.context?.draft,
    auto_publish: input.auto_publish ?? sourceRun.context?.autoPublish ?? true,
    auth_level: input.auth_level || sourceRun.context?.authLevel || "service_account",
    tenant_id: input.tenant_id || sourceRun.context?.tenantId || "default"
  };
}

function deriveFailureReason(run) {
  if (run.state === "done") return null;
  const failedEvent = [...(run.events || [])].reverse().find((event) => ["failed", "degraded"].includes(event.status));
  if (failedEvent?.message) return failedEvent.message;
  if (run.message) return run.message;
  return "任务未完成，请查看事件日志";
}

function isRetryable(run) {
  return ["failed", "blocked", "manual_review"].includes(run.state);
}

function deriveRetrySuggestions(run, failureReason) {
  if (!isRetryable(run)) {
    return [];
  }

  const reason = String(failureReason || "");
  const suggestions = new Set();

  if (reason.includes("preflight_blocked")) {
    suggestions.add("先调用 POST /v1/system/preflight，补齐 real 模式所需的 API_BASE/API_TOKEN 与健康检查路径。");
  }
  if (reason.includes("adapter_config_invalid")) {
    suggestions.add("调用 POST /v1/system/profile/validate 校验接口映射，修复缺失 action 或模板变量。");
  }
  if (reason.includes("风控") || reason.includes("risk")) {
    suggestions.add("补齐核心组件与素材 material_id，确保风险项清零后再重试。");
  }
  if (reason.includes("灰度") || reason.includes("rollout")) {
    suggestions.add("确认 ENABLE_REAL_AUTO_PUBLISH=true 且 tenant 在 AUTOPUBLISH_TENANT_ALLOWLIST 中。");
  }
  if (reason.includes("api_")) {
    suggestions.add("核对微页面后端接口可达性和鉴权，再执行续跑。");
  }

  suggestions.add(`调用 POST /v1/runs/${encodeURIComponent(run.id)}/resume 触发断点续跑。`);
  suggestions.add(`必要时先调用 POST /v1/runs/${encodeURIComponent(run.id)}/takeover 进入人工接管。`);

  return Array.from(suggestions);
}

module.exports = {
  Orchestrator
};
