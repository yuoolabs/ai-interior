const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildAdapterConfigFromEnv, validateAdapterConfig } = require("../services/page-adapter-config");

test("adapter config validation should fail when required action missing", () => {
  const config = {
    uploadMaterial: { method: "POST", path: "/materials" },
    actions: {
      create_page: { method: "POST", path: "/pages" }
    }
  };

  const result = validateAdapterConfig(config);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((item) => item.startsWith("action_missing")));
});

test("adapter config should support profile file loading", () => {
  const oldInlineConfig = process.env.MICROPAGE_API_ENDPOINTS_JSON;
  const oldProfile = process.env.MICROPAGE_API_PROFILE_FILE;
  const tempFile = path.join(__dirname, "tmp-adapter-profile.json");
  fs.writeFileSync(
    tempFile,
    JSON.stringify({
      actions: {
        create_page: { path: "/x/create", method: "POST" },
        set_page_name: { path: "/x/name", method: "PATCH" },
        add_component: { path: "/x/add", method: "POST" },
        fill_component: { path: "/x/fill", method: "POST" },
        save_page: { path: "/x/save", method: "POST" },
        publish_page: { path: "/x/publish", method: "POST" }
      }
    }),
    "utf8"
  );

  process.env.MICROPAGE_API_PROFILE_FILE = tempFile;
  delete process.env.MICROPAGE_API_ENDPOINTS_JSON;

  const config = buildAdapterConfigFromEnv();
  const result = validateAdapterConfig(config);

  try {
    assert.equal(result.valid, true);
    const endpoint = config.actions.create_page.path({});
    assert.equal(endpoint, "/x/create");
  } finally {
    fs.unlinkSync(tempFile);
    if (oldInlineConfig === undefined) delete process.env.MICROPAGE_API_ENDPOINTS_JSON;
    else process.env.MICROPAGE_API_ENDPOINTS_JSON = oldInlineConfig;
    if (oldProfile === undefined) delete process.env.MICROPAGE_API_PROFILE_FILE;
    else process.env.MICROPAGE_API_PROFILE_FILE = oldProfile;
  }
});
