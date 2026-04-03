const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAdapterConfigFromEnv } = require("../services/page-adapter-config");
const { PageAdapter } = require("../services/page-adapter");

test("adapter config should allow env-based endpoint override", async () => {
  const oldInlineConfig = process.env.MICROPAGE_API_ENDPOINTS_JSON;
  const oldProfile = process.env.MICROPAGE_API_PROFILE_FILE;
  const originalFetch = global.fetch;

  process.env.MICROPAGE_API_ENDPOINTS_JSON = JSON.stringify({
    uploadMaterial: {
      method: "POST",
      path: "/media/upload",
      payloadTemplate: {
        file: "{{input.filePath}}",
        title: "{{input.title}}"
      },
      parseTemplate: {
        materialId: "{{res.data.id}}",
        status: "uploaded",
        statusLabel: "已上传素材库",
        integrationHint: "custom"
      }
    },
    actions: {
      create_page: {
        method: "POST",
        path: "/custom/pages"
      }
    }
  });

  const config = buildAdapterConfigFromEnv();
  assert.equal(typeof config.uploadMaterial.payload, "function");
  assert.equal(typeof config.actions.create_page.path, "function");

  let called = null;
  try {
    global.fetch = async (url, options) => {
      called = { url, options };
      return {
        ok: true,
        headers: new Map([["content-type", "application/json"]]),
        json: async () => ({ data: { id: "m_001" } }),
        text: async () => ""
      };
    };

    const adapter = new PageAdapter({
      mode: "real",
      apiBaseUrl: "https://example.com",
      apiToken: "token",
      config
    });

    const material = await adapter.uploadMaterial({
      filePath: "/tmp/a.svg",
      title: "banner",
      prompt: "prompt",
      quality: { passed: true, issues: [] }
    });

    assert.equal(called.url, "https://example.com/media/upload");
    const body = JSON.parse(called.options.body);
    assert.equal(body.file, "/tmp/a.svg");
    assert.equal(material.materialId, "m_001");
  } finally {
    global.fetch = originalFetch;
    if (oldInlineConfig === undefined) delete process.env.MICROPAGE_API_ENDPOINTS_JSON;
    else process.env.MICROPAGE_API_ENDPOINTS_JSON = oldInlineConfig;
    if (oldProfile === undefined) delete process.env.MICROPAGE_API_PROFILE_FILE;
    else process.env.MICROPAGE_API_PROFILE_FILE = oldProfile;
  }
});
