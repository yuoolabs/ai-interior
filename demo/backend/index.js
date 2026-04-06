const path = require("node:path");
const { ModelGateway } = require("./models/model-gateway");
const { RunStore } = require("./store/run-store");
const { AuditService } = require("./services/audit-service");
const { RiskEngine } = require("./services/risk-engine");
const { ReferenceService } = require("./services/reference-service");
const { IntentService } = require("./services/intent-service");
const { DesignService } = require("./services/design-service");
const { PageAdapter } = require("./services/page-adapter");
const { validateAdapterConfig } = require("./services/page-adapter-config");
const { RolloutPolicy } = require("./services/rollout-policy");
const { AssetPipeline } = require("./services/asset-pipeline");
const { ExecutionStateMachine } = require("./services/state-machine");
const { Orchestrator } = require("./services/orchestrator");
const { buildComponentPolicyFromEnv } = require("./services/component-policy");
const { loadComponentSkinCatalog } = require("./services/component-skin-catalog");

function createOrchestrator({ rootDir, uiFallbackRunner } = {}) {
  const modelGateway = new ModelGateway();
  const runStore = new RunStore();
  const auditService = new AuditService({
    rootDir: path.join(rootDir || process.cwd(), "logs"),
    filePath: path.join(rootDir || process.cwd(), "logs", "audit-events.log")
  });
  const riskEngine = new RiskEngine();
  const referenceService = new ReferenceService({ modelGateway });
  const intentService = new IntentService({ modelGateway, referenceService });
  const designService = new DesignService({ modelGateway });
  const pageAdapter = new PageAdapter({ uiFallbackRunner });
  const rolloutPolicy = new RolloutPolicy({
    mode: pageAdapter.mode
  });
  const assetPipeline = new AssetPipeline({ modelGateway, pageAdapter, rootDir: rootDir || process.cwd() });
  const stateMachine = new ExecutionStateMachine({ pageAdapter, riskEngine, rolloutPolicy, auditService, maxRetries: 1 });

  return new Orchestrator({
    intentService,
    designService,
    assetPipeline,
    stateMachine,
    runStore,
    auditService,
    pageAdapter,
    modelGateway
  });
}

function getSystemConfig() {
  const adapterMode = process.env.MICROPAGE_ADAPTER_MODE || "mock";
  const adapter = new PageAdapter({ mode: adapterMode });
  const validation = validateAdapterConfig(adapter.config);
  const componentPolicy = buildComponentPolicyFromEnv();
  const componentSkinCatalog = loadComponentSkinCatalog({ rootDir: process.cwd() });

  const modelProvider = process.env.MODEL_PROVIDER || "mock";
  const modelApiKey = process.env.MODEL_API_KEY || (modelProvider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);
  const defaultModelName = modelProvider === "gemini" ? "gemini-2.5-flash" : "gpt-5-mini";
  const defaultBaseUrl = modelProvider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.openai.com/v1";

  return {
    model: {
      provider: modelProvider,
      name: process.env.MODEL_NAME || defaultModelName,
      hasApiKey: Boolean(modelApiKey),
      baseUrl: process.env.MODEL_BASE_URL || defaultBaseUrl
    },
    adapter: {
      mode: adapterMode,
      apiBaseSet: Boolean(process.env.MICROPAGE_API_BASE),
      apiBase: process.env.MICROPAGE_API_BASE || "",
      apiTokenSet: Boolean(process.env.MICROPAGE_API_TOKEN),
      customEndpointMappingSet: Boolean(process.env.MICROPAGE_API_ENDPOINTS_JSON || process.env.MICROPAGE_API_PROFILE_FILE),
      profileFileSet: Boolean(process.env.MICROPAGE_API_PROFILE_FILE),
      profileFile: process.env.MICROPAGE_API_PROFILE_FILE || "",
      healthPath: process.env.MICROPAGE_API_HEALTH_PATH || "/health",
      configValid: validation.valid,
      configErrors: validation.errors
    },
    rollout: {
      enableRealAutoPublish: String(process.env.ENABLE_REAL_AUTO_PUBLISH || "false").toLowerCase() === "true",
      tenantAllowlist: String(process.env.AUTOPUBLISH_TENANT_ALLOWLIST || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    },
    componentPolicy: {
      strict: componentPolicy.strict,
      allowedModules: componentPolicy.allowedModules,
      allowedComponents: componentPolicy.allowedComponents
    },
    componentSkins: {
      file: componentSkinCatalog.file,
      summary: componentSkinCatalog.summary
    }
  };
}

function getComponentSkinCatalog(options = {}) {
  return loadComponentSkinCatalog({ rootDir: options.rootDir || process.cwd() });
}

module.exports = {
  createOrchestrator,
  getSystemConfig,
  getComponentSkinCatalog
};
