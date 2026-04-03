const test = require("node:test");
const assert = require("node:assert/strict");
const { redactSensitive, sanitizeText } = require("../utils/redact");

test("redactSensitive should mask token-like keys", () => {
  const input = {
    token: "abcdef123456",
    Authorization: "Bearer abcdef",
    nested: {
      apiKey: "k-12345"
    }
  };

  const out = redactSensitive(input);
  assert.notEqual(out.token, input.token);
  assert.equal(out.Authorization, "Be***ef");
  assert.equal(out.nested.apiKey, "k-***45");
});

test("sanitizeText should remove bearer token", () => {
  const text = "Authorization: Bearer abc.def.ghi token=abc123";
  const out = sanitizeText(text);
  assert.ok(!out.includes("abc.def.ghi"));
  assert.ok(!out.includes("abc123"));
});
