const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { loadEnvFile } = require("../utils/env-loader");

test("env-loader should load key values from .env style file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-loader-"));
  const filePath = path.join(tempDir, ".env.local");
  fs.writeFileSync(
    filePath,
    [
      "# comment",
      "MODEL_PROVIDER=gemini",
      "MICROPAGE_ADAPTER_MODE=ui_only",
      "EMPTY_VALUE=",
      "SPACED = ok",
      ""
    ].join("\n"),
    "utf8"
  );

  const backup = {
    MODEL_PROVIDER: process.env.MODEL_PROVIDER,
    MICROPAGE_ADAPTER_MODE: process.env.MICROPAGE_ADAPTER_MODE,
    EMPTY_VALUE: process.env.EMPTY_VALUE,
    SPACED: process.env.SPACED
  };

  delete process.env.MODEL_PROVIDER;
  delete process.env.MICROPAGE_ADAPTER_MODE;
  delete process.env.EMPTY_VALUE;
  delete process.env.SPACED;

  try {
    const result = loadEnvFile({ cwd: tempDir, fileName: ".env.local" });
    assert.equal(result.loaded, true);
    assert.equal(result.count, 4);
    assert.equal(process.env.MODEL_PROVIDER, "gemini");
    assert.equal(process.env.MICROPAGE_ADAPTER_MODE, "ui_only");
    assert.equal(process.env.EMPTY_VALUE, "");
    assert.equal(process.env.SPACED, "ok");
  } finally {
    restoreEnv(backup);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("env-loader should keep existing env when override is false", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-loader-"));
  const filePath = path.join(tempDir, ".env.local");
  fs.writeFileSync(filePath, "MODEL_PROVIDER=gemini\n", "utf8");

  const backup = {
    MODEL_PROVIDER: process.env.MODEL_PROVIDER
  };

  process.env.MODEL_PROVIDER = "openai";

  try {
    const result = loadEnvFile({ cwd: tempDir, fileName: ".env.local", override: false });
    assert.equal(result.loaded, true);
    assert.equal(process.env.MODEL_PROVIDER, "openai");
  } finally {
    restoreEnv(backup);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function restoreEnv(backup) {
  Object.entries(backup).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}
