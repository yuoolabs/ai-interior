const path = require("node:path");
const { loadComponentSkinCatalog } = require("../backend/services/component-skin-catalog");

const rootDir = path.join(__dirname, "..");
const catalog = loadComponentSkinCatalog({ rootDir });
const components = Object.entries(catalog.components || {});
const missing = components.filter(([, item]) => !item.available);

console.log(`skin file: ${catalog.file}`);
console.log(`components: ${catalog.summary.total}`);
console.log(`with screenshot: ${catalog.summary.withScreenshot}`);
console.log(`missing screenshot: ${catalog.summary.missingScreenshot}`);

if (!missing.length) {
  console.log("all component skins are ready");
  process.exit(0);
}

console.log("missing component skin screenshots:");
missing.forEach(([key, item]) => {
  console.log(`- ${key}: ${item.screenshot || "(not configured)"}`);
});

process.exit(1);
