const SENSITIVE_KEYS = [
  "token",
  "authorization",
  "api_key",
  "apikey",
  "secret",
  "password",
  "cookie"
];

function redactSensitive(value, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 8;
  return walk(value, 0, maxDepth);
}

function walk(value, depth, maxDepth) {
  if (depth > maxDepth) return "[MaxDepth]";
  if (value == null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, depth + 1, maxDepth));
  }

  if (typeof value === "object") {
    const output = {};
    Object.entries(value).forEach(([key, item]) => {
      if (isSensitiveKey(key)) {
        output[key] = maskValue(item);
      } else {
        output[key] = walk(item, depth + 1, maxDepth);
      }
    });
    return output;
  }

  if (typeof value === "string") {
    return sanitizeText(value);
  }

  return value;
}

function isSensitiveKey(key) {
  const lower = String(key || "").toLowerCase();
  return SENSITIVE_KEYS.some((item) => lower.includes(item));
}

function maskValue(value) {
  if (value == null) return "***";
  if (typeof value === "string") {
    if (value.length <= 4) return "***";
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }
  return "***";
}

function sanitizeText(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .replace(/(token|authorization|api[_-]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=***");
}

module.exports = {
  redactSensitive,
  sanitizeText
};
