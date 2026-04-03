class RunStore {
  constructor() {
    this.runs = new Map();
  }

  createRun(payload = {}) {
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const run = {
      id: runId,
      state: "created",
      message: "任务已创建",
      currentStep: "created",
      retries: 0,
      events: [],
      logs: [],
      context: payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      outputs: {}
    };
    this.runs.set(runId, run);
    return run;
  }

  getRun(id) {
    return this.runs.get(id) || null;
  }

  updateRun(id, patch = {}) {
    const run = this.getRun(id);
    if (!run) return null;
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    return run;
  }

  appendEvent(id, event) {
    const run = this.getRun(id);
    if (!run) return null;
    const next = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      stage: event.stage || "runtime_execution",
      title: event.title || "未命名事件",
      message: event.message || "",
      status: event.status || "running",
      kind: event.kind || "action",
      details: event.details ?? null
    };
    run.events.push(next);
    run.updatedAt = new Date().toISOString();
    return next;
  }

  appendLog(id, logLine) {
    const run = this.getRun(id);
    if (!run) return null;
    run.logs.push(logLine);
    run.updatedAt = new Date().toISOString();
    return run;
  }
}

module.exports = {
  RunStore
};
