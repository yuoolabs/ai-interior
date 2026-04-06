const fs = require("node:fs");
const path = require("node:path");

class AssetPipeline {
  constructor({ modelGateway, pageAdapter, rootDir }) {
    this.modelGateway = modelGateway;
    this.pageAdapter = pageAdapter;
    this.outputDir = path.join(rootDir, "assets", "generated");
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  async generateAndUpload({ parsed, componentPlan, referenceAnalysis }) {
    const visualComponents = (componentPlan || []).filter((item) => item.displayName === "图文广告" || item.component === "banner");
    if (!visualComponents.length) return [];

    const assets = [];

    for (let index = 0; index < visualComponents.length; index += 1) {
      const component = visualComponents[index];
      const id = `asset_${Date.now()}_${index + 1}`;
      const title = `${component.displayName}-${parsed.page_goal || "页面"}-${index + 1}`;
      const promptSeed = this.buildPrompt({ parsed, component, referenceAnalysis });
      const prompt = await this.modelGateway.generateImagePrompt({
        prompt: promptSeed,
        fallback: (value) => value
      });

      const palette = this.resolvePalette(parsed, referenceAnalysis);
      const width = 1125;
      const height = 720;
      const fileName = `${Date.now()}-${component.component || component.module}-${index + 1}.svg`;
      const localPath = path.join(this.outputDir, fileName);

      const svg = renderGeneratedAssetSvg({
        title,
        componentDisplayName: component.displayName,
        goal: parsed.page_goal || "卖货转化",
        style: parsed.style || "品牌感",
        demand: parsed.raw_demand || "自动生成素材",
        palette,
        width,
        height
      });

      fs.writeFileSync(localPath, svg, "utf8");

      const quality = this.qualityCheck({ width, height, prompt, svg });
      const upload = await this.pageAdapter.uploadMaterial({
        filePath: localPath,
        title,
        prompt,
        quality
      });

      assets.push({
        id,
        title,
        componentModule: component.module,
        componentDisplayName: component.displayName,
        prompt,
        promptSummary: `按组件原生样式生成，目标为${parsed.page_goal || "页面转化"}`,
        publicUrl: `/assets/generated/${fileName}`,
        localPath,
        width,
        height,
        palette,
        quality,
        uploadStatus: upload.status,
        uploadStatusLabel: upload.statusLabel,
        material_id: upload.materialId,
        integrationHint: upload.integrationHint
      });
    }

    return assets;
  }

  buildPrompt({ parsed, component, referenceAnalysis }) {
    return [
      `为微页面组件“${component.displayName}(${component.component})”生成素材图。`,
      "必须贴合微页面组件原生样式，禁止海报化排版和复杂装饰。",
      "画面结构保持简洁：主图 + 简短利益点 + 行动引导，留出组件文案区域。",
      `页面目标：${parsed.page_goal || "卖货转化"}`,
      `页面风格：${parsed.style || "品牌感"}`,
      `主题色策略：${parsed.theme_color_label || "使用页面主题色"}`,
      `需求摘要：${parsed.raw_demand || "未提供"}`,
      referenceAnalysis?.hints?.style ? `参考图风格：${referenceAnalysis.hints.style}` : "",
      referenceAnalysis?.hints?.paletteSummary ? `参考图配色：${referenceAnalysis.hints.paletteSummary}` : ""
    ]
      .filter(Boolean)
      .join(" ");
  }

  resolvePalette(parsed, referenceAnalysis) {
    const referencePalette = Array.isArray(referenceAnalysis?.palette) ? referenceAnalysis.palette : [];
    const fallbackPalette = ["#8C4B2F", "#F0D2BE", "#F8F4EE"];
    const custom = parsed?.theme_color_mode === "custom" && parsed?.theme_color_value ? [parsed.theme_color_value] : [];
    return [...new Set([...custom, ...referencePalette, ...fallbackPalette])].slice(0, 3);
  }

  qualityCheck({ width, height, prompt, svg }) {
    const issues = [];
    if (width < 600 || height < 400) issues.push("resolution_too_low");
    if (!prompt || prompt.length < 20) issues.push("prompt_too_short");
    if (!String(svg).includes("<svg")) issues.push("invalid_svg");

    return {
      passed: issues.length === 0,
      issues,
      checkedAt: new Date().toISOString()
    };
  }
}

function renderGeneratedAssetSvg({ title, componentDisplayName, goal, style, demand, palette, width, height }) {
  const [primary, secondary, surface] = palette;
  const safeTitle = escapeXml(title);
  const safeComponentName = escapeXml(componentDisplayName);
  const safeGoal = escapeXml(goal);
  const safeStyle = escapeXml(style);
  const safeDemand = escapeXml(String(demand).slice(0, 42));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${escapeXml(lightenHex(surface, 0.2))}"/>
      <stop offset="100%" stop-color="${escapeXml(lightenHex(primary, 0.08))}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="24" fill="url(#bg)"/>
  <rect x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.1)}" width="${Math.round(width * 0.9)}" height="${Math.round(height * 0.8)}" rx="20" fill="#ffffff" fill-opacity="0.93"/>
  <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.16)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.42)}" rx="16" fill="${escapeXml(lightenHex(secondary, 0.35))}"/>
  <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.3)}" r="${Math.round(height * 0.11)}" fill="${escapeXml(lightenHex(primary, 0.45))}" fill-opacity="0.78"/>
  <text x="${Math.round(width * 0.1)}" y="${Math.round(height * 0.66)}" fill="#2d2018" font-family="'Noto Serif SC','PingFang SC','Microsoft YaHei',serif" font-size="${Math.round(width * 0.045)}" font-weight="700">${safeGoal}</text>
  <text x="${Math.round(width * 0.1)}" y="${Math.round(height * 0.73)}" fill="#5f4637" font-family="'Manrope','PingFang SC','Microsoft YaHei',sans-serif" font-size="${Math.round(width * 0.023)}">${safeStyle} · ${safeComponentName}</text>
  <text x="${Math.round(width * 0.1)}" y="${Math.round(height * 0.8)}" fill="#745a4b" font-family="'Manrope','PingFang SC','Microsoft YaHei',sans-serif" font-size="${Math.round(width * 0.02)}">${safeDemand}</text>
  <rect x="${Math.round(width * 0.1)}" y="${Math.round(height * 0.84)}" width="${Math.round(width * 0.22)}" height="${Math.round(height * 0.09)}" rx="${Math.round(height * 0.045)}" fill="${escapeXml(lightenHex(primary, 0.02))}"/>
  <text x="${Math.round(width * 0.152)}" y="${Math.round(height * 0.897)}" fill="#fffaf3" font-family="'Manrope','PingFang SC','Microsoft YaHei',sans-serif" font-size="${Math.round(width * 0.02)}" font-weight="700">立即查看</text>
  <text x="${Math.round(width * 0.66)}" y="${Math.round(height * 0.9)}" fill="#947b6a" font-family="'Manrope','PingFang SC','Microsoft YaHei',sans-serif" font-size="${Math.round(width * 0.015)}">${safeTitle}</text>
</svg>`;
}

function lightenHex(hex, amount) {
  const value = String(hex || "#8C4B2F").replace("#", "");
  const full = value.length === 3 ? value.split("").map((item) => item + item).join("") : value.padEnd(6, "0");
  const channels = full.match(/.{2}/g)?.map((item) => Number.parseInt(item, 16)) || [140, 75, 47];
  const mixed = channels.map((channel) => Math.round(channel + (255 - channel) * amount));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

module.exports = {
  AssetPipeline
};
