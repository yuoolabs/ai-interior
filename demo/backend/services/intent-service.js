const { parseIntentFallback } = require("./fallback-planner");

class IntentService {
  constructor({ modelGateway, referenceService }) {
    this.modelGateway = modelGateway;
    this.referenceService = referenceService;
  }

  async parse(payload = {}) {
    const reference = await this.referenceService.analyze(payload.reference || null);

    const input = {
      demand: payload.demand || "",
      industry: payload.industry || "",
      goal: payload.goal || "",
      style: payload.style || "",
      themeColorMode: payload.themeColorMode || "page",
      customThemeColor: payload.customThemeColor || "#8C4B2F",
      reference
    };

    const structured = await this.modelGateway.generateStructured({
      capability: "intent_parse",
      input,
      schema: {
        type: "object",
        required: ["page_goal", "industry", "style", "modules", "raw_demand"],
        properties: {
          page_goal: { type: "string" },
          industry: { type: "string" },
          style: { type: "string" },
          modules: { type: "array" },
          raw_demand: { type: "string" }
        }
      },
      fallback: () => parseIntentFallback(input)
    });

    const fallbackBase = parseIntentFallback(input);

    return {
      ...fallbackBase,
      page_goal: structured.page_goal || fallbackBase.page_goal,
      industry: structured.industry || fallbackBase.industry,
      style: structured.style || fallbackBase.style,
      modules: Array.isArray(structured.modules) && structured.modules.length ? structured.modules : fallbackBase.modules,
      raw_demand: structured.raw_demand || fallbackBase.raw_demand,
      reference_analysis: reference,
      model_fallback: Boolean(structured._modelFallback),
      model_fallback_reason: structured._fallbackReason || ""
    };
  }
}

module.exports = {
  IntentService
};
