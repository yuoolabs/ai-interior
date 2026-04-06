const { buildDraftFromIntent } = require("./fallback-planner");
const { MODULE_LIBRARY } = require("../utils/domain-rules");

const MODULE_ALIAS_MAP = {
  banner: "banner",
  hero: "banner",
  hero_banner: "banner",
  benefit: "benefit_bar",
  benefit_bar: "benefit_bar",
  value_bar: "benefit_bar",
  coupon: "coupon",
  vouchers: "coupon",
  countdown: "countdown",
  timer: "countdown",
  product: "product_grid",
  product_grid: "product_grid",
  goods: "product_grid",
  member: "member_form",
  member_form: "member_form",
  event: "event_form",
  event_form: "event_form",
  booking: "event_form",
  search: "search_entry",
  search_entry: "search_entry",
  live: "live_room",
  live_room: "live_room",
  cta: "cta",
  action: "cta"
};

class DesignService {
  constructor({ modelGateway }) {
    this.modelGateway = modelGateway;
  }

  async generate(intent) {
    const blueprint = await this.modelGateway.generateStructured({
      capability: "design_blueprint",
      input: {
        page_goal: intent.page_goal,
        industry: intent.industry,
        style: intent.style,
        modules: intent.modules,
        demand: intent.raw_demand,
        reference: intent.reference_analysis?.hints || null
      },
      schema: {
        type: "object",
        required: ["module_order", "section_purposes", "page_name", "visual_style"],
        properties: {
          module_order: { type: "array" },
          section_purposes: { type: "object" },
          page_name: { type: "string" },
          visual_style: { type: "string" }
        }
      },
      fallback: ({ modules, style, page_goal }) => ({
        module_order: modules || [],
        section_purposes: {},
        page_name: `${page_goal || "微页面"}-AI设计稿`,
        visual_style: style || "品牌感"
      })
    });

    const moduleOrder = sanitizeModuleOrder(blueprint.module_order);
    const mergedIntent = {
      ...intent,
      modules: moduleOrder.length ? moduleOrder : intent.modules,
      style: blueprint.visual_style || intent.style
    };
    const baseDraft = buildDraftFromIntent(mergedIntent);

    if (blueprint.page_name && baseDraft.execution) {
      baseDraft.execution.page_name = sanitizePageName(blueprint.page_name);
    }

    if (blueprint.section_purposes && typeof blueprint.section_purposes === "object" && Array.isArray(baseDraft.pageStructure)) {
      baseDraft.pageStructure = baseDraft.pageStructure.map((section) => ({
        ...section,
        purpose: blueprint.section_purposes[section.type] || section.purpose
      }));
    }

    const copy = await this.modelGateway.generateStructured({
      capability: "copy_generation",
      input: {
        page_goal: intent.page_goal,
        style: intent.style,
        modules: intent.modules,
        demand: intent.raw_demand
      },
      schema: {
        type: "object",
        required: ["headline", "subheadline", "cta"],
        properties: {
          headline: { type: "string" },
          subheadline: { type: "string" },
          cta: { type: "string" }
        }
      },
      fallback: ({ page_goal }) => ({
        headline: page_goal === "会员拉新" ? "现在开卡，立刻解锁权益" : page_goal === "活动推广" ? "活动报名进行中" : "限时好价，立即抢购",
        subheadline: "AI 已基于你的需求生成页面结构与组件策略",
        cta: "立即进入活动"
      })
    });

    return {
      ...baseDraft,
      designBlueprint: {
        module_order: moduleOrder,
        section_purposes: blueprint.section_purposes || {},
        page_name: blueprint.page_name || "",
        visual_style: blueprint.visual_style || mergedIntent.style || "",
        modelFallback: Boolean(blueprint._modelFallback),
        modelFallbackReason: blueprint._fallbackReason || ""
      },
      copyDraft: {
        headline: copy.headline,
        subheadline: copy.subheadline,
        cta: copy.cta,
        modelFallback: Boolean(copy._modelFallback),
        modelFallbackReason: copy._fallbackReason || ""
      },
      designMeta: {
        generatedAt: new Date().toISOString(),
        architecture: "orchestrator-v1"
      }
    };
  }
}

module.exports = {
  DesignService
};

function sanitizeModuleOrder(order) {
  if (!Array.isArray(order)) return [];
  const allowed = new Set(Object.keys(MODULE_LIBRARY));
  const normalized = [];
  order.forEach((item) => {
    const key = normalizeModuleKey(item);
    if (!key || !allowed.has(key)) return;
    if (!normalized.includes(key)) normalized.push(key);
  });
  return normalized;
}

function normalizeModuleKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (MODULE_ALIAS_MAP[raw]) return MODULE_ALIAS_MAP[raw];
  return raw;
}

function sanitizePageName(name) {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .trim()
    .slice(0, 40) || `AI-${Date.now()}`;
}
