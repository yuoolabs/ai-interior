const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { PageAdapter } = require("../services/page-adapter");

test("preflight should pass in mock mode", async () => {
  const adapter = new PageAdapter({ mode: "mock" });
  const result = await adapter.preflight();
  assert.equal(result.ok, true);
  assert.equal(result.mode, "mock");
});

test("preflight should fail in real mode when credential missing", async () => {
  const adapter = new PageAdapter({
    mode: "real",
    apiBaseUrl: "",
    apiToken: ""
  });
  const result = await adapter.preflight({ strict: true });
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((item) => item.name === "credentials_check"));
});

test("preflight should pass in real mode with reachable health endpoint", async () => {
  const port = 19000 + Math.floor(Math.random() * 500);
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  try {
    const adapter = new PageAdapter({
      mode: "real",
      apiBaseUrl: `http://127.0.0.1:${port}`,
      apiToken: "token"
    });
    const result = await adapter.preflight({ strict: true });
    assert.equal(result.ok, true);
    assert.ok(result.checks.every((item) => item.ok));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
