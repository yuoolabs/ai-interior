const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createOrchestrator } = require("../index");
const { parseIntentFallback, buildDraftFromIntent } = require("../services/fallback-planner");
const { RiskEngine } = require("../services/risk-engine");

process.env.MODEL_PROVIDER = "mock";
process.env.MICROPAGE_ADAPTER_MODE = "mock";

test("fallback planner should produce complete draft", () => {
  const parsed = parseIntentFallback({
    demand: "做一个母婴大促卖货页，突出满减和爆款商品",
    themeColorMode: "custom",
    customThemeColor: "#FF6600",
    reference: {
      fileName: "母婴大促参考图.png",
      hints: {
        modules: ["banner", "coupon", "product_grid", "cta"],
        suggestedGoal: "卖货转化",
        style: "大促"
      }
    }
  });

  const draft = buildDraftFromIntent(parsed);

  assert.equal(parsed.page_goal, "卖货转化");
  assert.ok(Array.isArray(parsed.modules) && parsed.modules.length >= 4);
  assert.ok(Array.isArray(draft.componentPlan) && draft.componentPlan.length > 0);
  assert.equal(draft.execution.executor, "micro-page-state-machine");
  assert.ok(Array.isArray(draft.execution.actionGraph.nodes));
});

test("risk engine should block publish when unresolved modules exist", () => {
  const riskEngine = new RiskEngine();
  const risk = riskEngine.evaluatePublish({
    draft: {
      validation: {
        missing_components: ["banner"],
        unresolved_modules: ["video"]
      },
      componentPlan: [{ displayName: "图文广告" }]
    },
    assets: [],
    runContext: { authLevel: "service_account" }
  });

  assert.equal(risk.allowPublish, false);
  assert.equal(risk.blocked, true);
  assert.ok(risk.findings.some((item) => item.code === "MISSING_CORE_MODULE"));
});

test("orchestrator should run full mock pipeline and auto publish", async () => {
  const orchestrator = createOrchestrator({
    rootDir: path.join(__dirname, "..", "..")
  });

  const design = await orchestrator.generateDesign({
    demand: "做一个活动推广页，突出报名入口",
    style: "品牌感",
    themeColorMode: "page"
  });

  assert.ok(design.design_id);
  assert.ok(design.execution?.actionGraph?.nodes?.length > 0);

  const assets = await orchestrator.generateAssetsAndUpload({ design_id: design.design_id });
  assert.ok(Array.isArray(assets.assets));

  const execute = await orchestrator.executePage({
    design_id: design.design_id,
    auto_publish: true,
    auth_level: "service_account"
  });

  assert.ok(execute.run_id);

  let run = orchestrator.getRun(execute.run_id);
  let guard = 0;
  while (run && run.state !== "done" && run.state !== "failed" && run.state !== "blocked" && guard < 60) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    run = orchestrator.getRun(execute.run_id);
    guard += 1;
  }

  assert.ok(run);
  assert.equal(run.state, "done");
  assert.ok(Array.isArray(run.events) && run.events.length > 0);
});
