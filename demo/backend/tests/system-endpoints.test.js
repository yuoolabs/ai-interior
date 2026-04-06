const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");

test("system endpoints should provide config and profile validation", async () => {
  const port = 19000 + Math.floor(Math.random() * 1000);
  const appEnvFile = `.env.test.${port}`;
  const appEnvPath = path.join(ROOT, appEnvFile);
  const server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      APP_ENV_FILE: appEnvFile,
      MODEL_PROVIDER: "mock",
      MICROPAGE_ADAPTER_MODE: "mock",
      MICROPAGE_API_ENDPOINTS_JSON: "",
      MICROPAGE_API_PROFILE_FILE: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let logs = "";
  server.stdout?.on("data", (chunk) => {
    logs += String(chunk || "");
  });
  server.stderr?.on("data", (chunk) => {
    logs += String(chunk || "");
  });

  try {
    await waitForServer(`http://127.0.0.1:${port}`, server, () => logs);

    const health = await getJson(`http://127.0.0.1:${port}/v1/system/health`);
    assert.equal(health.status, "ok");

    const config = await getJson(`http://127.0.0.1:${port}/v1/system/config`);
    assert.equal(typeof config.env?.loaded, "boolean");
    assert.equal(typeof config.system?.adapter?.configValid, "boolean");
    assert.equal(typeof config.system?.componentPolicy?.strict, "boolean");
    assert.ok(Array.isArray(config.system?.componentPolicy?.allowedModules));
    assert.ok(Array.isArray(config.system?.componentPolicy?.allowedComponents));
    assert.equal(typeof config.system?.componentSkins?.summary?.total, "number");

    const skins = await getJson(`http://127.0.0.1:${port}/v1/system/component-skins`);
    assert.equal(typeof skins.skins?.summary?.total, "number");
    assert.equal(typeof skins.skins?.components, "object");

    const rollout = await getJson(`http://127.0.0.1:${port}/v1/system/rollout`);
    assert.equal(typeof rollout.rollout?.realAutoPublishEnabled, "boolean");

    const preflight = await postJson(`http://127.0.0.1:${port}/v1/system/preflight`, { strict: true });
    assert.equal(typeof preflight.ok, "boolean");
    assert.equal(typeof preflight.model?.provider, "string");
    assert.ok(Array.isArray(preflight.model?.checks));

    const profileValidation = await postJson(`http://127.0.0.1:${port}/v1/system/profile/validate`, {
      profile: {
        actions: {
          create_page: { method: "POST", path: "/p/create" },
          set_page_name: { method: "PATCH", path: "/p/name" },
          add_component: { method: "POST", path: "/p/add" },
          fill_component: { method: "POST", path: "/p/fill" },
          save_page: { method: "POST", path: "/p/save" },
          publish_page: { method: "POST", path: "/p/publish" }
        }
      }
    });

    assert.equal(profileValidation.valid, true);
    assert.ok(Array.isArray(profileValidation.hints));

    const saved = await postJson(`http://127.0.0.1:${port}/v1/system/config/save`, {
      model: {
        provider: "gemini",
        name: "gemini-2.5-flash",
        apiKey: "unit_test_key"
      },
      adapter: {
        mode: "ui_only"
      }
    });

    assert.equal(saved.saved?.saved, true);
    assert.equal(saved.system?.model?.provider, "gemini");
    assert.equal(saved.system?.model?.hasApiKey, true);
    assert.equal(saved.system?.adapter?.mode, "ui_only");
    assert.equal(fs.existsSync(appEnvPath), true);

    const modelPreflight = await postJson(`http://127.0.0.1:${port}/v1/system/model/preflight`, { strict: false });
    assert.equal(typeof modelPreflight.ok, "boolean");
    assert.equal(typeof modelPreflight.provider, "string");
    assert.ok(Array.isArray(modelPreflight.checks));

    const requireModelResponse = await fetch(`http://127.0.0.1:${port}/v1/intent/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        demand: "做一个卖货页",
        require_model: true
      })
    });
    assert.equal(requireModelResponse.status, 422);
    const requireModelPayload = await requireModelResponse.json();
    assert.equal(typeof requireModelPayload.message, "string");
    assert.equal(typeof requireModelPayload.reason, "string");
  } finally {
    server.kill("SIGTERM");
    fs.rmSync(appEnvPath, { force: true });
  }
});

async function waitForServer(baseUrl, server, getLogs) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) {
      throw new Error(`server_exited_early: code=${server.exitCode}; logs=${getLogs()}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.status === 200 || response.status === 404) return;
    } catch {
      // ignore
    }
    await sleep(100);
  }
  throw new Error("server_start_timeout");
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request_failed:${url}:${response.status}`);
  }
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`request_failed:${url}:${response.status}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
