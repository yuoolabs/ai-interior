const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadComponentSkinCatalog } = require("../services/component-skin-catalog");

test("component skin catalog should load map and expose summary", () => {
  const rootDir = path.join(__dirname, "..", "..");
  const catalog = loadComponentSkinCatalog({ rootDir });

  assert.equal(typeof catalog.summary.total, "number");
  assert.ok(catalog.summary.total >= 1);
  assert.equal(typeof catalog.components.banner, "object");
  assert.equal(typeof catalog.components.banner.available, "boolean");
});
