const MAX_SIDE = 160;

export async function analyzeReferenceImage(file) {
  // Best for multimodal: 这里是最适合替换成视觉/多模态模型的入口。
  if (!file) return null;

  const dataUrl = await readAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const { width, height, pixels } = samplePixels(image);

  const palette = pickPalette(pixels);
  const stats = summarizePixels(pixels);
  const sections = detectSections(pixels, width, height);
  const layoutZones = detectLayoutZones({ pixels, width, height, sections, stats });
  const hints = buildHints({ file, width, height, palette, stats, sections, layoutZones });

  return {
    fileName: file.name,
    previewUrl: dataUrl,
    width,
    height,
    orientation: width >= height ? "横版" : "竖版",
    palette,
    stats,
    sections,
    layoutZones,
    hints
  };
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });
}

function samplePixels(image) {
  // Keep rule-based for fallback: 本地像素采样适合作为无模型时的轻量兜底方案。
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(24, Math.round(image.width * scale));
  const height = Math.max(24, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  return { width, height, pixels: data };
}

function summarizePixels(pixels) {
  let brightnessSum = 0;
  let saturationSum = 0;
  let warmPixels = 0;
  let darkPixels = 0;
  const total = pixels.length / 4;

  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const { hue, saturation, lightness } = rgbToHsl(r, g, b);

    brightnessSum += lightness;
    saturationSum += saturation;
    if ((hue <= 45 || hue >= 330) && saturation > 0.35) warmPixels += 1;
    if (lightness < 0.22) darkPixels += 1;
  }

  return {
    brightness: round(brightnessSum / total),
    saturation: round(saturationSum / total),
    warmRatio: round(warmPixels / total),
    darkRatio: round(darkPixels / total)
  };
}

function pickPalette(pixels) {
  const buckets = new Map();
  for (let index = 0; index < pixels.length; index += 16) {
    const r = quantize(pixels[index]);
    const g = quantize(pixels[index + 1]);
    const b = quantize(pixels[index + 2]);
    const key = `${r},${g},${b}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => {
      const [r, g, b] = key.split(",").map(Number);
      return rgbToHex(r, g, b);
    });
}

function detectSections(pixels, width, height) {
  // AI candidate: 当前按亮度/饱和度切分区块，后续可改成模型直接理解版式结构。
  const rowSignals = [];
  for (let y = 0; y < height; y += 1) {
    let rowBrightness = 0;
    let rowSaturation = 0;
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const { saturation, lightness } = rgbToHsl(pixels[index], pixels[index + 1], pixels[index + 2]);
      rowBrightness += lightness;
      rowSaturation += saturation;
    }
    rowSignals.push({
      brightness: rowBrightness / width,
      saturation: rowSaturation / width
    });
  }

  const cutLines = [];
  for (let y = 1; y < rowSignals.length; y += 1) {
    const diff =
      Math.abs(rowSignals[y].brightness - rowSignals[y - 1].brightness) +
      Math.abs(rowSignals[y].saturation - rowSignals[y - 1].saturation) * 0.8;
    if (diff > 0.18 && (cutLines.length === 0 || y - cutLines[cutLines.length - 1] > 10)) {
      cutLines.push(y);
    }
  }

  const sections = [];
  let start = 0;
  [...cutLines, height].forEach((end) => {
    const size = end - start;
    if (size > 8) {
      sections.push({
        from: round(start / height),
        to: round(end / height),
        weight: round(size / height)
      });
    }
    start = end;
  });

  return sections.slice(0, 6);
}

function detectLayoutZones({ pixels, width, height, sections, stats }) {
  // Best for multimodal: 区域角色判断很依赖视觉语义，模型会比规则更准确。
  const zones = [];
  const getSectionStats = (section) => {
    const yStart = Math.max(0, Math.floor(section.from * height));
    const yEnd = Math.min(height, Math.ceil(section.to * height));
    let brightnessSum = 0;
    let saturationSum = 0;
    let darkCount = 0;
    let strongCount = 0;
    let total = 0;

    for (let y = yStart; y < yEnd; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const { saturation, lightness } = rgbToHsl(pixels[index], pixels[index + 1], pixels[index + 2]);
        brightnessSum += lightness;
        saturationSum += saturation;
        if (lightness < 0.24) darkCount += 1;
        if (saturation > 0.42) strongCount += 1;
        total += 1;
      }
    }

    return {
      brightness: brightnessSum / total,
      saturation: saturationSum / total,
      darkRatio: darkCount / total,
      strongRatio: strongCount / total
    };
  };

  sections.forEach((section, index) => {
    const part = section.to <= 0.35 ? "顶部" : section.from >= 0.72 ? "底部" : "中间";
    const statsBySection = getSectionStats(section);
    let role = "benefit_bar";
    let label = `${part}信息区`;

    if (index === 0 || (part === "顶部" && section.weight >= 0.22)) {
      role = "banner";
      label = "顶部大图";
    } else if (part === "中间" && section.weight >= 0.11 && statsBySection.strongRatio > 0.18) {
      role = "product_grid";
      label = "中间商品区";
    } else if (part === "底部" && (statsBySection.darkRatio > 0.28 || statsBySection.strongRatio > 0.22)) {
      role = "cta";
      label = "底部按钮区";
    } else if (part === "中间" && statsBySection.strongRatio > 0.2) {
      role = "coupon";
      label = "中间促销区";
    }

    zones.push({
      role,
      label,
      from: section.from,
      to: section.to,
      weight: section.weight
    });
  });

  if (!zones.some((zone) => zone.role === "banner")) {
    zones.unshift({ role: "banner", label: "顶部大图", from: 0, to: 0.25, weight: 0.25 });
  }
  if (!zones.some((zone) => zone.role === "product_grid") && sections.length >= 4) {
    zones.splice(Math.min(2, zones.length), 0, {
      role: "product_grid",
      label: "中间商品区",
      from: 0.45,
      to: 0.72,
      weight: 0.27
    });
  }
  if (!zones.some((zone) => zone.role === "cta")) {
    zones.push({ role: "cta", label: "底部按钮区", from: 0.84, to: 1, weight: 0.16 });
  }

  return dedupeZones(zones);
}

function buildHints({ file, width, height, palette, stats, sections, layoutZones }) {
  // AI candidate: 这里负责把图像统计翻译成“风格/目标/模块建议”，非常适合交给模型生成。
  const fileToken = file.name.toLowerCase();
  const modules = ["banner", "benefit_bar", "cta"];
  const reasons = [];

  if (stats.warmRatio > 0.28 || fileToken.includes("促销") || fileToken.includes("大促")) {
    modules.push("coupon", "countdown");
    reasons.push("参考图偏暖色，像促销页");
  }

  if (sections.length >= 4 || fileToken.includes("商品") || fileToken.includes("卖货")) {
    modules.push("product_grid");
    reasons.push("参考图分区较多，适合商品承接");
  }

  if ((stats.darkRatio > 0.2 && stats.saturation < 0.35) || fileToken.includes("会员")) {
    modules.push("member_form");
    reasons.push("画面更像权益/会员表达");
  }

  if (fileToken.includes("活动") || fileToken.includes("报名")) {
    modules.push("event_form");
    reasons.push("文件名带有活动线索");
  }

  if (width > height * 1.2) {
    reasons.push("头图区域更宽，Banner 权重更高");
  }

  const style =
    stats.warmRatio > 0.28 ? "大促" :
    stats.brightness > 0.72 ? "清新" :
    "品牌感";

  return {
    style,
    suggestedGoal: suggestGoal(modules, fileToken),
    modules: [...new Set(modules)],
    zoneModules: layoutZones.map((item) => item.role),
    reasons: reasons.length ? reasons : ["参考图信息较少，按通用营销页处理"],
    paletteSummary: palette.join(" / "),
    sectionCount: sections.length,
    zoneSummary: layoutZones.map((item) => `${item.label}(${item.role})`)
  };
}

function suggestGoal(modules, fileToken) {
  if (modules.includes("member_form") && !modules.includes("product_grid")) return "会员拉新";
  if (modules.includes("event_form") || fileToken.includes("活动")) return "活动推广";
  return "卖货转化";
}

function rgbToHsl(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { hue: 0, saturation: 0, lightness };
  }

  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;

  switch (max) {
    case red:
      hue = (green - blue) / delta + (green < blue ? 6 : 0);
      break;
    case green:
      hue = (blue - red) / delta + 2;
      break;
    default:
      hue = (red - green) / delta + 4;
      break;
  }

  return { hue: hue * 60, saturation, lightness };
}

function quantize(value) {
  return Math.min(255, Math.round(value / 32) * 32);
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function dedupeZones(zones) {
  const seen = new Set();
  return zones.filter((zone) => {
    const key = `${zone.role}-${zone.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
