const fs = require("node:fs");
const path = require("node:path");

function loadComponentSkinCatalog({ rootDir }) {
  const defaultPath = path.join(rootDir, "backend", "config", "component-skin-map.json");
  const customPath = process.env.MICROPAGE_COMPONENT_SKIN_FILE;
  const resolvedPath = customPath
    ? (path.isAbsolute(customPath) ? customPath : path.resolve(rootDir, customPath))
    : defaultPath;

  const base = {
    file: resolvedPath,
    version: "v1",
    components: {},
    summary: {
      total: 0,
      withScreenshot: 0,
      missingScreenshot: 0
    }
  };

  if (!fs.existsSync(resolvedPath)) {
    return base;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch {
    return {
      ...base,
      summary: {
        ...base.summary,
        parseError: true
      }
    };
  }

  const components = parsed?.components && typeof parsed.components === "object" ? parsed.components : {};
  const normalized = {};
  let withScreenshot = 0;

  Object.entries(components).forEach(([componentKey, skin]) => {
    const item = skin && typeof skin === "object" ? skin : {};
    const screenshot = String(item.screenshot || "").trim();
    const available = screenshot ? checkScreenshotAvailable(rootDir, screenshot) : false;
    if (available) withScreenshot += 1;
    normalized[componentKey] = {
      name: item.name || componentKey,
      screenshot,
      available,
      fit: item.fit || "cover",
      notes: item.notes || "",
      slots: Array.isArray(item.slots) ? item.slots : []
    };
  });

  const total = Object.keys(normalized).length;

  return {
    file: resolvedPath,
    version: parsed?.version || "v1",
    components: normalized,
    summary: {
      total,
      withScreenshot,
      missingScreenshot: Math.max(total - withScreenshot, 0)
    }
  };
}

function checkScreenshotAvailable(rootDir, screenshot) {
  if (!screenshot) return false;
  if (/^https?:\/\//i.test(screenshot)) return true;
  const resolved = screenshot.startsWith("/")
    ? path.resolve(rootDir, `.${screenshot}`)
    : path.resolve(rootDir, screenshot);
  return fs.existsSync(resolved);
}

module.exports = {
  loadComponentSkinCatalog
};
