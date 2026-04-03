const fs = require("node:fs");
const path = require("node:path");
const { redactSensitive } = require("../utils/redact");

class AuditService {
  constructor(options = {}) {
    this.records = [];
    this.filePath = options.filePath || path.join(options.rootDir || process.cwd(), "audit-events.log");
  }

  record(event = {}) {
    const safeDetails = redactSensitive(event.details ?? null);
    const entry = {
      traceId: event.traceId || `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      runId: event.runId || null,
      type: event.type || "info",
      actor: event.actor || "system",
      timestamp: new Date().toISOString(),
      details: safeDetails
    };
    this.records.push(entry);
    this.persist(entry);
    return entry;
  }

  listByRun(runId) {
    return this.records.filter((item) => item.runId === runId);
  }

  persist(entry) {
    const line = `${JSON.stringify(entry)}\n`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, line, "utf8");
  }
}

module.exports = {
  AuditService
};
