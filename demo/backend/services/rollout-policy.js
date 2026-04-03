class RolloutPolicy {
  constructor(options = {}) {
    this.mode = options.mode || process.env.MICROPAGE_ADAPTER_MODE || "mock";
    this.realAutoPublishEnabled =
      options.realAutoPublishEnabled != null
        ? Boolean(options.realAutoPublishEnabled)
        : String(process.env.ENABLE_REAL_AUTO_PUBLISH || "false").toLowerCase() === "true";
    this.allowlist = parseAllowlist(options.allowlist ?? (process.env.AUTOPUBLISH_TENANT_ALLOWLIST || ""));
  }

  evaluate({ runContext }) {
    const tenantId = String(runContext?.tenantId || "default");

    if (this.mode !== "real") {
      return {
        allowPublish: true,
        blocked: false,
        reason: "non_real_mode"
      };
    }

    if (!this.realAutoPublishEnabled) {
      return {
        allowPublish: false,
        blocked: true,
        reason: "real_auto_publish_disabled"
      };
    }

    if (this.allowlist.length && !this.allowlist.includes(tenantId)) {
      return {
        allowPublish: false,
        blocked: true,
        reason: `tenant_not_in_allowlist:${tenantId}`
      };
    }

    return {
      allowPublish: true,
      blocked: false,
      reason: "rollout_policy_passed"
    };
  }

  getStatus() {
    return {
      mode: this.mode,
      realAutoPublishEnabled: this.realAutoPublishEnabled,
      allowlist: this.allowlist
    };
  }
}

function parseAllowlist(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((item) => String(item).trim()).filter(Boolean);
  return String(raw)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  RolloutPolicy
};
