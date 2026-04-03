const test = require("node:test");
const assert = require("node:assert/strict");
const { RolloutPolicy } = require("../services/rollout-policy");

test("rollout policy should always pass in mock mode", () => {
  const policy = new RolloutPolicy({ mode: "mock" });
  const result = policy.evaluate({ runContext: { tenantId: "t1" } });
  assert.equal(result.allowPublish, true);
});

test("rollout policy should block real mode when switch is off", () => {
  const policy = new RolloutPolicy({ mode: "real", realAutoPublishEnabled: false });
  const result = policy.evaluate({ runContext: { tenantId: "t1" } });
  assert.equal(result.allowPublish, false);
  assert.equal(result.reason, "real_auto_publish_disabled");
});

test("rollout policy should enforce tenant allowlist", () => {
  const policy = new RolloutPolicy({
    mode: "real",
    realAutoPublishEnabled: true,
    allowlist: ["tenant_a", "tenant_b"]
  });

  const pass = policy.evaluate({ runContext: { tenantId: "tenant_a" } });
  const blocked = policy.evaluate({ runContext: { tenantId: "tenant_x" } });

  assert.equal(pass.allowPublish, true);
  assert.equal(blocked.allowPublish, false);
  assert.ok(blocked.reason.includes("tenant_not_in_allowlist"));
});
