const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");

test("system endpoints should provide config and profile validation", async () => {
  const port = 19000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
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
    assert.equal(typeof config.system?.adapter?.configValid, "boolean");
    assert.equal(typeof config.system?.componentPolicy?.strict, "boolean");
    assert.ok(Array.isArray(config.system?.componentPolicy?.allowedModules));
    assert.ok(Array.isArray(config.system?.componentPolicy?.allowedComponents));

    const rollout = await getJson(`http://127.0.0.1:${port}/v1/system/rollout`);
    assert.equal(typeof rollout.rollout?.realAutoPublishEnabled, "boolean");

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
  } finally {
    server.kill("SIGTERM");
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
