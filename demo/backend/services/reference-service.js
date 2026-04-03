class ReferenceService {
  constructor({ modelGateway }) {
    this.modelGateway = modelGateway;
  }

  async analyze(reference = null) {
    if (!reference) return null;

    const fileName = String(reference.fileName || "");
    const fallback = () => this.fallbackAnalyze(reference);

    const structured = await this.modelGateway.generateStructured({
      capability: "reference_understanding",
      input: {
        fileName,
        imageDataUrl: reference.imageDataUrl || "",
        hint: reference.hints || null
      },
      schema: {
        type: "object",
        required: ["style", "suggestedGoal", "modules", "reasons", "zoneModules", "paletteSummary", "zoneSummary"],
        properties: {
          style: { type: "string" },
          suggestedGoal: { type: "string" },
          modules: { type: "array" },
          reasons: { type: "array" },
          zoneModules: { type: "array" },
          paletteSummary: { type: "string" },
          zoneSummary: { type: "array" }
        }
      },
      fallback
    });

    return {
      fileName,
      previewUrl: reference.imageDataUrl || null,
      orientation: reference.orientation || "未知",
      hints: {
        style: structured.style || "品牌感",
        suggestedGoal: structured.suggestedGoal || "卖货转化",
        modules: Array.isArray(structured.modules) ? structured.modules : [],
        reasons: Array.isArray(structured.reasons) ? structured.reasons : [],
        zoneModules: Array.isArray(structured.zoneModules) ? structured.zoneModules : [],
        paletteSummary: structured.paletteSummary || "#8C4B2F / #F0D2BE / #F8F4EE",
        zoneSummary: Array.isArray(structured.zoneSummary) ? structured.zoneSummary : []
      },
      _modelFallback: Boolean(structured._modelFallback)
    };
  }

  fallbackAnalyze(reference) {
    const token = String(reference.fileName || "").toLowerCase();
    const modules = ["banner", "benefit_bar", "cta"];
    const reasons = [];

    if (token.includes("促销") || token.includes("大促")) {
      modules.push("coupon", "countdown");
      reasons.push("参考图名称包含促销语义");
    }

    if (token.includes("商品") || token.includes("卖货")) {
      modules.push("product_grid");
      reasons.push("参考图名称包含商品语义");
    }

    if (token.includes("会员")) {
      modules.push("member_form");
      reasons.push("参考图名称包含会员语义");
    }

    if (token.includes("活动") || token.includes("报名")) {
      modules.push("event_form");
      reasons.push("参考图名称包含活动语义");
    }

    return {
      style: token.includes("大促") ? "大促" : "品牌感",
      suggestedGoal: token.includes("会员") ? "会员拉新" : token.includes("活动") ? "活动推广" : "卖货转化",
      modules: [...new Set(modules)],
      reasons: reasons.length ? reasons : ["无模型场景下按文件名语义兜底"],
      zoneModules: ["banner", "benefit_bar", "product_grid", "cta"],
      paletteSummary: "#8C4B2F / #F0D2BE / #F8F4EE",
      zoneSummary: ["顶部主视觉(banner)", "利益点区(benefit_bar)", "商品区(product_grid)", "底部行动区(cta)"]
    };
  }
}

module.exports = {
  ReferenceService
};
