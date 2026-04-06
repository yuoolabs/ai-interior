const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");

test("v1 api contract should satisfy end-to-end flow", async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
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

    try {
      const health = await getJson(`http://127.0.0.1:${port}/v1/system/health`);
      assert.equal(health.status, "ok");
      assert.equal(typeof health.system?.adapter?.configValid, "boolean");

      const preflight = await postJson(`http://127.0.0.1:${port}/v1/system/preflight`, {
        strict: true
      });
      assert.equal(typeof preflight.ok, "boolean");
      assert.ok(Array.isArray(preflight.checks));

      const intent = await postJson(`http://127.0.0.1:${port}/v1/intent/parse`, {
        demand: "做一个活动推广页，突出报名入口",
        style: "品牌感"
      });
      assert.ok(intent.parsed?.page_goal);

      const design = await postJson(`http://127.0.0.1:${port}/v1/design/generate`, {
        intent: intent.parsed
      });
      assert.ok(design.design_id);
      assert.ok(Array.isArray(design.componentPlan));

      const assets = await postJson(`http://127.0.0.1:${port}/v1/assets/generate-and-upload`, {
        design_id: design.design_id
      });
      assert.ok(Array.isArray(assets.assets));

      const execute = await postJson(`http://127.0.0.1:${port}/v1/page/execute`, {
        design_id: design.design_id,
        auto_publish: true,
        auth_level: "service_account"
      });
      assert.ok(execute.run_id);

      const run = await pollRunFinal(`http://127.0.0.1:${port}`, execute.run_id);

      assert.ok(run);
      assert.equal(run.run_id, execute.run_id);
      assert.ok(["done", "failed", "blocked"].includes(run.state));
      assert.ok(Array.isArray(run.events));
      assert.equal(typeof run.retryable, "boolean");
      assert.ok(Array.isArray(run.retry_suggestions));
      assert.equal(typeof run.audit_trace_id, "string");
      assert.equal(run.failure_reason, null);

      const executeManual = await postJson(`http://127.0.0.1:${port}/v1/page/execute`, {
        design_id: design.design_id,
        auto_publish: false,
        auth_level: "service_account"
      });
      assert.ok(executeManual.run_id);

      const takeover = await postJson(`http://127.0.0.1:${port}/v1/runs/${encodeURIComponent(executeManual.run_id)}/takeover`, {
        reason: "人工接管核对投放信息",
        operator: "qa_operator"
      });
      assert.equal(takeover.state, "manual_review");
      assert.equal(takeover.retryable, true);
      assert.equal(takeover.failure_reason, "人工接管核对投放信息");

      const resumed = await postJson(`http://127.0.0.1:${port}/v1/runs/${encodeURIComponent(executeManual.run_id)}/resume`, {
        auto_publish: true,
        auth_level: "service_account"
      });
      assert.ok(resumed.run_id);
      assert.equal(resumed.resume_from_run_id, executeManual.run_id);

      const resumedRun = await pollRunFinal(`http://127.0.0.1:${port}`, resumed.run_id);
      assert.equal(resumedRun.resume_from_run_id, executeManual.run_id);
      assert.ok(["done", "failed", "blocked"].includes(resumedRun.state));

      const autoBuild = await postJson(`http://127.0.0.1:${port}/v1/page/auto-build`, {
        demand: "做一个卖货转化页面，突出优惠券和爆款商品",
        style: "大促",
        auto_publish: true,
        auth_level: "service_account"
      });
      assert.ok(autoBuild.run_id);
      assert.ok(autoBuild.design_id);
      assert.ok(Array.isArray(autoBuild.design?.componentPlan));
      assert.ok(autoBuild.design_draft?.execution?.page_name);
      assert.ok(Array.isArray(autoBuild.design_draft?.componentPlan));
      assert.ok(Array.isArray(autoBuild.design_draft?.generatedAssets));
      assert.equal(typeof autoBuild.execute?.state, "string");
      assert.equal(typeof autoBuild.trace_ids?.intent, "string");
    } catch (error) {
      throw new Error(`${error.message}; server_logs=${logs.slice(0, 600)}`);
    }
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

async function postJson(url, payload) {
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`request_failed:${url}:${response.status}`);
  }
  return response.json();
}

async function getJson(url) {
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`request_failed:${url}:${response.status}`);
  }
  return response.json();
}

async function pollRunFinal(baseUrl, runId) {
  let run = null;
  for (let i = 0; i < 40; i += 1) {
    run = await getJson(`${baseUrl}/v1/runs/${encodeURIComponent(runId)}`);
    if (["done", "failed", "blocked", "manual_review"].includes(run.state)) break;
    await sleep(100);
  }
  return run;
}

async function fetchWithRetry(url, options, retries = 12) {
  let lastError = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (i === retries) break;
      await sleep(180 * (i + 1));
    }
  }
  throw lastError || new Error("fetch_failed");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
