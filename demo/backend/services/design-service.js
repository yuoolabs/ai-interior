const { buildDraftFromIntent } = require("./fallback-planner");

class DesignService {
  constructor({ modelGateway }) {
    this.modelGateway = modelGateway;
  }

  async generate(intent) {
    const baseDraft = buildDraftFromIntent(intent);

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
      copyDraft: {
        headline: copy.headline,
        subheadline: copy.subheadline,
        cta: copy.cta,
        modelFallback: Boolean(copy._modelFallback)
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
