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
    pageAdapter
  });
}

function getSystemConfig() {
  const adapterMode = process.env.MICROPAGE_ADAPTER_MODE || "mock";
  const adapter = new PageAdapter({ mode: adapterMode });
  const validation = validateAdapterConfig(adapter.config);

  return {
    model: {
      provider: process.env.MODEL_PROVIDER || "mock",
      name: process.env.MODEL_NAME || "gpt-5-mini",
      hasApiKey: Boolean(process.env.OPENAI_API_KEY)
    },
    adapter: {
      mode: adapterMode,
      apiBaseSet: Boolean(process.env.MICROPAGE_API_BASE),
      apiTokenSet: Boolean(process.env.MICROPAGE_API_TOKEN),
      customEndpointMappingSet: Boolean(process.env.MICROPAGE_API_ENDPOINTS_JSON || process.env.MICROPAGE_API_PROFILE_FILE),
      profileFileSet: Boolean(process.env.MICROPAGE_API_PROFILE_FILE),
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
    }
  };
}

module.exports = {
  createOrchestrator,
  getSystemConfig
};
