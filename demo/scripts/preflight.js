#!/usr/bin/env node

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:8001";

(async () => {
  try {
    const health = await getJson(`${baseUrl}/v1/system/health`);
    const config = await getJson(`${baseUrl}/v1/system/config`);
    const preflight = await postJson(`${baseUrl}/v1/system/preflight`, { strict: true });

    const summary = {
      health: health.status,
      modelProvider: config.system?.model?.provider,
      adapterMode: config.system?.adapter?.mode,
      configValid: config.system?.adapter?.configValid,
      preflightOk: preflight.ok,
      checks: preflight.checks || []
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!preflight.ok) {
      process.exitCode = 2;
      return;
    }

    process.exitCode = 0;
  } catch (error) {
    console.error(`preflight_error: ${error.message || "unknown_error"}`);
    process.exitCode = 1;
  }
})();

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status}`);
  }
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`POST ${url} -> ${response.status}`);
  }
  return response.json();
}
