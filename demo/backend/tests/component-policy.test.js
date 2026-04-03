const test = require("node:test");
const assert = require("node:assert/strict");
const { parseIntentFallback, buildDraftFromIntent } = require("../services/fallback-planner");
const { RiskEngine } = require("../services/risk-engine");

test("strict component policy should mark out-of-catalog modules unresolved and block publish", () => {
  const oldStrict = process.env.MICROPAGE_STRICT_COMPONENT_POLICY;
  const oldModules = process.env.MICROPAGE_ALLOWED_MODULES;
  const oldComponents = process.env.MICROPAGE_ALLOWED_COMPONENTS;

  process.env.MICROPAGE_STRICT_COMPONENT_POLICY = "true";
  process.env.MICROPAGE_ALLOWED_MODULES = "banner,benefit_bar,coupon,countdown,product_grid,cta";
  process.env.MICROPAGE_ALLOWED_COMPONENTS = "banner,title,coupon,limit,product,linkNav";

  try {
    const parsed = parseIntentFallback({
      demand: "做一个卖货页，增加直播和商品转化",
      goal: "卖货转化"
    });
    const draft = buildDraftFromIntent(parsed);

    const liveRoom = draft.componentPlan.find((item) => item.module === "live_room");
    assert.ok(liveRoom);
    assert.equal(liveRoom.status, "unresolved");
    assert.ok(liveRoom.reason.includes("允许清单"));

    assert.ok(draft.validation.unresolved_modules.includes("live_room"));
    assert.ok(draft.validation.blocked_by_component_policy.includes("live_room"));
    assert.equal(draft.execution.actionGraph.nodes.some((node) => node.payload?.module === "live_room"), false);

    const risk = new RiskEngine().evaluatePublish({
      draft,
      assets: [],
      runContext: { authLevel: "service_account" }
    });
    assert.equal(risk.allowPublish, false);
    assert.ok(risk.findings.some((item) => item.code === "COMPONENT_POLICY_BLOCK"));
  } finally {
    if (oldStrict === undefined) delete process.env.MICROPAGE_STRICT_COMPONENT_POLICY;
    else process.env.MICROPAGE_STRICT_COMPONENT_POLICY = oldStrict;
    if (oldModules === undefined) delete process.env.MICROPAGE_ALLOWED_MODULES;
    else process.env.MICROPAGE_ALLOWED_MODULES = oldModules;
    if (oldComponents === undefined) delete process.env.MICROPAGE_ALLOWED_COMPONENTS;
    else process.env.MICROPAGE_ALLOWED_COMPONENTS = oldComponents;
  }
});
