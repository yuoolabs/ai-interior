class RiskEngine {
  evaluatePublish({ draft, assets, runContext }) {
    const findings = [];

    const missingCore = draft?.validation?.missing_components || [];
    if (missingCore.length) {
      findings.push({ level: "high", code: "MISSING_CORE_MODULE", message: `缺少核心模块: ${missingCore.join(",")}` });
    }

    const unresolved = draft?.validation?.unresolved_modules || [];
    if (unresolved.length) {
      findings.push({ level: "high", code: "UNRESOLVED_MODULE", message: `存在未实现模块: ${unresolved.join(",")}` });
    }

    const blockedByPolicy = draft?.validation?.blocked_by_component_policy || [];
    if (blockedByPolicy.length) {
      findings.push({ level: "high", code: "COMPONENT_POLICY_BLOCK", message: `存在不在允许清单的模块: ${blockedByPolicy.join(",")}` });
    }

    const visualNeeded = (draft?.componentPlan || []).some((item) => item.displayName === "图文广告");
    const visualReady = Array.isArray(assets) && assets.some((item) => item.material_id);
    if (visualNeeded && !visualReady) {
      findings.push({ level: "medium", code: "MATERIAL_NOT_READY", message: "图文广告未拿到素材库 material_id" });
    }

    if (runContext?.authLevel !== "service_account") {
      findings.push({ level: "medium", code: "WEAK_IDENTITY", message: "发布身份不是服务账号" });
    }

    const blocked = findings.some((item) => item.level === "high");
    return {
      blocked,
      level: blocked ? "high" : findings.length ? "medium" : "low",
      findings,
      allowPublish: !blocked
    };
  }
}

module.exports = {
  RiskEngine
};
