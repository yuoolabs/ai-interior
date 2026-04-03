function createDefaultAdapterConfig() {
  return {
    uploadMaterial: {
      method: "POST",
      path: "/materials",
      payload: ({ input }) => ({
        title: input.title,
        prompt: input.prompt,
        filePath: input.filePath,
        quality: input.quality
      }),
      parse: (res) => ({
        materialId: res.material_id || res.id || null,
        status: res.material_id || res.id ? "uploaded" : "pending_material_upload",
        statusLabel: res.material_id || res.id ? "已上传素材库" : "上传失败，待人工确认",
        integrationHint: "素材已通过 API 入库"
      })
    },
    actions: {
      create_page: {
        method: "POST",
        path: "/pages",
        payload: ({ run, runtime }) => ({
          name: run.context?.pageName || run.context?.draft?.execution?.page_name || `AI-${Date.now()}`,
          goal: run.context?.draft?.parsed?.page_goal || "卖货转化",
          metadata: {
            runId: run.id,
            source: "ai_orchestrator"
          },
          existingPageId: runtime.pageId || null
        }),
        parse: (res) => ({ pageId: res.page_id || res.id || null, ok: true })
      },
      set_page_name: {
        method: "PATCH",
        path: ({ runtime }) => `/pages/${runtime.pageId}`,
        payload: ({ node, run }) => ({
          name: node.payload?.pageName || run.context?.draft?.execution?.page_name
        })
      },
      add_component: {
        method: "POST",
        path: ({ runtime }) => `/pages/${runtime.pageId}/components`,
        payload: ({ node }) => ({
          type: node.payload?.component,
          module: node.payload?.module,
          displayName: node.payload?.displayName,
          fields: node.payload?.fields || []
        })
      },
      fill_component: {
        method: "POST",
        path: ({ runtime }) => `/pages/${runtime.pageId}/components/fill`,
        payload: ({ node, assets }) => ({
          component: node.payload?.component,
          displayName: node.payload?.displayName,
          assetMaterialId: pickMaterialId(assets, node.payload),
          fallback: true
        })
      },
      save_page: {
        method: "POST",
        path: ({ runtime }) => `/pages/${runtime.pageId}/save`,
        payload: () => ({})
      },
      publish_page: {
        method: "POST",
        path: ({ runtime }) => `/pages/${runtime.pageId}/publish`,
        payload: () => ({})
      }
    }
  };
}

function buildAdapterConfigFromEnv() {
  const base = createDefaultAdapterConfig();
  const inlineRaw = process.env.MICROPAGE_API_ENDPOINTS_JSON;
  const profilePath = process.env.MICROPAGE_API_PROFILE_FILE;
  const profileRaw = readProfileFromFile(profilePath);

  const custom = parseCustomConfig(inlineRaw) || parseCustomConfig(profileRaw);
  if (!custom) return base;
  applyCustomConfig(base, custom);
  return base;
}

function parseCustomConfig(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readProfileFromFile(filePath) {
  if (!filePath) return "";
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) return "";
  return fs.readFileSync(resolved, "utf8");
}

function applyCustomConfig(base, custom) {
  if (custom.uploadMaterial) {
    base.uploadMaterial = {
      ...base.uploadMaterial,
      ...normalizeConfigEntry(custom.uploadMaterial, base.uploadMaterial)
    };
  }

  if (custom.actions && typeof custom.actions === "object") {
    Object.entries(custom.actions).forEach(([action, entry]) => {
      if (!base.actions[action]) return;
      base.actions[action] = {
        ...base.actions[action],
        ...normalizeConfigEntry(entry, base.actions[action])
      };
    });
  }
}

function validateAdapterConfig(config) {
  const errors = [];
  const requiredActions = ["create_page", "set_page_name", "add_component", "fill_component", "save_page", "publish_page"];

  if (!config || typeof config !== "object") {
    return { valid: false, errors: ["config_invalid"] };
  }

  if (!config.uploadMaterial || typeof config.uploadMaterial !== "object") {
    errors.push("uploadMaterial_missing");
  } else {
    if (!resolveMaybeString(config.uploadMaterial.method)) errors.push("uploadMaterial_method_missing");
    if (!config.uploadMaterial.path) errors.push("uploadMaterial_path_missing");
  }

  if (!config.actions || typeof config.actions !== "object") {
    errors.push("actions_missing");
  } else {
    requiredActions.forEach((action) => {
      const rule = config.actions[action];
      if (!rule) {
        errors.push(`action_missing:${action}`);
        return;
      }
      if (!resolveMaybeString(rule.method)) errors.push(`action_method_missing:${action}`);
      if (!rule.path) errors.push(`action_path_missing:${action}`);
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function resolveMaybeString(value) {
  if (typeof value === "string" && value.trim()) return value;
  return "";
}

function normalizeConfigEntry(entry, fallback) {
  if (!entry || typeof entry !== "object") return fallback;
  const next = { ...entry };

  if (typeof entry.path === "string") {
    next.path = (context) => hydrateTemplate(entry.path, context);
  }

  if (typeof entry.payloadTemplate === "object") {
    next.payload = ({ node, run, runtime, input }) => hydrateTemplate(entry.payloadTemplate, { node, run, runtime, input });
  }

  if (typeof entry.parseTemplate === "object") {
    next.parse = (res) => hydrateTemplate(entry.parseTemplate, { res });
  }

  return next;
}

function hydrateTemplate(template, context) {
  if (template == null) return template;
  if (Array.isArray(template)) return template.map((item) => hydrateTemplate(item, context));
  if (typeof template === "object") {
    const out = {};
    Object.entries(template).forEach(([key, value]) => {
      out[key] = hydrateTemplate(value, context);
    });
    return out;
  }
  if (typeof template === "string") {
    return template.replace(/\{\{\s*([^\s{}]+)\s*\}\}/g, (_, token) => {
      const value = token.split(".").reduce((acc, cur) => (acc == null ? acc : acc[cur]), context);
      return value == null ? "" : String(value);
    });
  }
  return template;
}

function pickMaterialId(assets, payload = {}) {
  if (!Array.isArray(assets) || !assets.length) return null;
  const hit = assets.find((asset) => asset.componentDisplayName === payload.displayName || asset.componentModule === payload.module);
  return hit?.material_id || null;
}

module.exports = {
  createDefaultAdapterConfig,
  buildAdapterConfigFromEnv,
  applyCustomConfig,
  validateAdapterConfig
};
const fs = require("node:fs");
const path = require("node:path");
