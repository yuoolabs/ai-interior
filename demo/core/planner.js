import { COMPONENT_DICTIONARY, PAGE_TEMPLATES, MODULE_LIBRARY } from "../rules.js";

export function parseInput({ demand, industry, goal, style, referenceFile, referenceAnalysis }) {
  const text = demand.trim();
  const token = text.toLowerCase();
  const referenceToken = [referenceFile?.name, ...(referenceAnalysis?.hints?.reasons || [])].join(" ").toLowerCase();
  const mergedToken = `${token} ${referenceToken}`.trim();

  const inferredIndustry =
    industry ||
    (mergedToken.includes("母婴")
      ? "母婴"
      : mergedToken.includes("美妆")
        ? "美妆"
        : mergedToken.includes("食品")
          ? "食品"
          : mergedToken.includes("服饰")
            ? "服饰"
            : "通用");

  let inferredGoal = goal;
  if (!inferredGoal) {
    if (mergedToken.includes("会员") || mergedToken.includes("拉新")) inferredGoal = "会员拉新";
    else if (mergedToken.includes("活动") || mergedToken.includes("报名")) inferredGoal = "活动推广";
    else inferredGoal = referenceAnalysis?.hints?.suggestedGoal || "卖货转化";
  }

  const inferredStyle =
    style ||
    (mergedToken.includes("大促")
      ? "大促"
      : referenceAnalysis?.hints?.style || "品牌感");
  const modules = detectModules(mergedToken, inferredGoal, referenceAnalysis);

  return {
    page_goal: inferredGoal,
    industry: inferredIndustry,
    style: inferredStyle,
    reference_image: referenceFile?.name || null,
    reference_analysis: referenceAnalysis || null,
    modules,
    raw_demand: text
  };
}

export function selectTemplate(parsed) {
  if (parsed.page_goal === "会员拉新") return PAGE_TEMPLATES.member;
  if (parsed.page_goal === "活动推广") return PAGE_TEMPLATES.activity;
  return PAGE_TEMPLATES.sales;
}

export function planPage(parsed, template) {
  const baseline = template.structure.map((item) => ({
    ...item,
    moduleMeta: MODULE_LIBRARY[item.type]
  }));
  const moduleSet = new Set(parsed.modules);
  const merged = baseline.filter((item) => item.required || moduleSet.has(item.type));

  moduleSet.forEach((moduleType) => {
    if (!merged.some((item) => item.type === moduleType)) {
      merged.push({
        type: moduleType,
        purpose: MODULE_LIBRARY[moduleType]?.purpose || "根据需求自动补充",
        required: false,
        moduleMeta: MODULE_LIBRARY[moduleType]
      });
    }
  });

  return reorderByReference(merged, parsed.reference_analysis);
}

export function mapComponents(pageStructure) {
  return pageStructure.map((block) => {
    const rule = COMPONENT_DICTIONARY[block.type];
    if (!rule) {
      return {
        module: block.type,
        status: "fallback",
        component: "richtext",
        displayName: "富文本",
        fallbackComponent: "title",
        reason: "没有命中规则，降级到文本组合",
        fields: ["title", "content"],
        limit: null,
        minVersion: null
      };
    }

    return {
      module: block.type,
      status: rule.status,
      component: rule.component,
      displayName: rule.displayName,
      fallbackComponent: rule.fallbackComponent,
      reason: rule.reason,
      fields: rule.fields,
      limit: rule.limit ?? null,
      minVersion: rule.minVersion ?? null
    };
  });
}

export function buildDraft(parsed) {
  const template = selectTemplate(parsed);
  const pageStructure = planPage(parsed, template);
  const componentPlan = mapComponents(pageStructure);

  return {
    parsed,
    template,
    pageStructure,
    componentPlan
  };
}

function detectModules(token, inferredGoal, referenceAnalysis) {
  // 按固定顺序声明候选，保证结构可预测
  const hasCoupon = token.includes("券") || token.includes("满减");
  const hasCountdown = token.includes("倒计时") || token.includes("限时");
  const hasSearch = token.includes("搜索");
  const hasLive = token.includes("直播");
  const hasProduct = token.includes("商品") || token.includes("商城") || token.includes("专享");

  let modules;

  if (inferredGoal === "会员拉新") {
    modules = [
      "benefit_bar",
      ...(hasCoupon ? ["coupon"] : []),
      "member_form"
    ];
  } else if (inferredGoal === "活动推广") {
    modules = [
      "banner",
      "benefit_bar",
      ...(hasSearch ? ["search_entry"] : []),
      ...(hasCoupon ? ["coupon"] : []),
      ...(hasCountdown ? ["countdown"] : []),
      "event_form",
      "cta"
    ];
  } else {
    // 卖货转化
    modules = [
      "banner",
      ...(hasSearch ? ["search_entry"] : []),
      "benefit_bar",
      ...(hasCoupon ? ["coupon"] : []),
      ...(hasCountdown ? ["countdown"] : []),
      ...(hasLive ? ["live_room"] : []),
      "product_grid",
      "cta"
    ];
  }

  // 参考图补充的模块追加到末尾（不打乱主结构）
  const referenceModules = (referenceAnalysis?.hints?.modules || []).filter(
    (m) => !modules.includes(m)
  );

  return [...new Set([...modules, ...referenceModules])];
}

function reorderByReference(pageStructure, referenceAnalysis) {
  const zoneModules = referenceAnalysis?.hints?.zoneModules;
  if (!zoneModules || zoneModules.length === 0) return pageStructure;

  const order = [];
  zoneModules.forEach((type) => {
    if (!order.includes(type)) order.push(type);
  });

  pageStructure.forEach((item) => {
    if (!order.includes(item.type)) order.push(item.type);
  });

  const rank = new Map(order.map((type, index) => [type, index]));
  return [...pageStructure].sort((a, b) => (rank.get(a.type) ?? 999) - (rank.get(b.type) ?? 999));
}
