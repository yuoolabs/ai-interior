const { COMPONENT_DICTIONARY } = require("../utils/domain-rules");

function buildComponentPolicyFromEnv() {
  const strict = String(process.env.MICROPAGE_STRICT_COMPONENT_POLICY || "true").toLowerCase() !== "false";

  const defaultModules = Object.keys(COMPONENT_DICTIONARY);
  const defaultComponents = Array.from(new Set(Object.values(COMPONENT_DICTIONARY).map((item) => item.component)));

  const modulesFromEnv = parseCsv(process.env.MICROPAGE_ALLOWED_MODULES);
  const componentsFromEnv = parseCsv(process.env.MICROPAGE_ALLOWED_COMPONENTS);

  const allowedModules = modulesFromEnv.length ? modulesFromEnv : defaultModules;
  const allowedComponents = componentsFromEnv.length ? componentsFromEnv : defaultComponents;

  return {
    strict,
    allowedModules,
    allowedComponents
  };
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  buildComponentPolicyFromEnv
};
