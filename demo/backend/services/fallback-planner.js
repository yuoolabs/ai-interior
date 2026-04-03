const { MODULE_LIBRARY, COMPONENT_DICTIONARY, PAGE_TEMPLATES } = require("../utils/domain-rules");
const { buildComponentPolicyFromEnv } = require("./component-policy");

function parseIntentFallback(input = {}) {
  const demand = String(input.demand || "").trim();
  const token = demand.toLowerCase();
  const referenceName = String(input.reference?.fileName || "").toLowerCase();
  const referenceToken = [referenceName, ...(input.reference?.hints?.reasons || [])].join(" ").toLowerCase();
  const merged = `${token} ${referenceToken}`.trim();

  const industry =
    input.industry ||
    (merged.includes("母婴")
      ? "母婴"
      : merged.includes("美妆")
        ? "美妆"
        : merged.includes("食品")
          ? "食品"
          : merged.includes("服饰")
            ? "服饰"
            : "通用");

  let pageGoal = input.goal;
  if (!pageGoal) {
    if (merged.includes("会员") || merged.includes("拉新")) pageGoal = "会员拉新";
    else if (merged.includes("活动") || merged.includes("报名")) pageGoal = "活动推广";
    else pageGoal = input.reference?.hints?.suggestedGoal || "卖货转化";
  }

  const style =
    input.style ||
    (merged.includes("大促") || merged.includes("促销")
      ? "大促"
      : input.reference?.hints?.style || "品牌感");

  const modules = detectModules(merged, pageGoal, input.reference);

  return {
    page_goal: pageGoal,
    industry,
    style,
    theme_color_mode: input.themeColorMode || "page",
    theme_color_value: input.themeColorMode === "custom" ? String(input.customThemeColor || "#8C4B2F").toUpperCase() : null,
    theme_color_label:
      input.themeColorMode === "custom"
        ? `自定义颜色 ${String(input.customThemeColor || "#8C4B2F").toUpperCase()}`
        : "使用小程序主题色",
    reference_image: input.reference?.fileName || null,
    reference_analysis: input.reference || null,
    modules,
    constraints: {
      automation: "full_auto_publish",
      governance: "strict"
    },
    raw_demand: demand
  };
}

function selectTemplate(parsed) {
  if (parsed.page_goal === "会员拉新") return PAGE_TEMPLATES.member;
  if (parsed.page_goal === "活动推广") return PAGE_TEMPLATES.activity;
  return PAGE_TEMPLATES.sales;
}

function planPage(parsed, template) {
  const baseline = template.structure.map((item) => ({ ...item, moduleMeta: MODULE_LIBRARY[item.type] }));
  const moduleSet = new Set(parsed.modules || []);
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

function mapComponents(pageStructure) {
  const componentPolicy = buildComponentPolicyFromEnv();
  const allowedModuleSet = new Set(componentPolicy.allowedModules);
  const allowedComponentSet = new Set(componentPolicy.allowedComponents);

  return pageStructure.map((block) => {
    const rule = COMPONENT_DICTIONARY[block.type];
    if (!rule) {
      return {
        module: block.type,
        status: "unresolved",
        component: "unmapped",
        displayName: "待人工映射",
        fallbackComponent: null,
        reason: "模块不在后台组件目录内，已阻断自动映射",
        fields: [],
        limit: null,
        minVersion: null
      };
    }

    if (componentPolicy.strict && !allowedModuleSet.has(block.type)) {
      return {
        module: block.type,
        status: "unresolved",
        component: rule.component,
        displayName: rule.displayName,
        fallbackComponent: null,
        reason: "模块不在允许清单，已阻断自动映射",
        fields: [],
        limit: rule.limit ?? null,
        minVersion: rule.minVersion ?? null
      };
    }

    if (componentPolicy.strict && !allowedComponentSet.has(rule.component)) {
      return {
        module: block.type,
        status: "unresolved",
        component: rule.component,
        displayName: rule.displayName,
        fallbackComponent: null,
        reason: "组件不在允许清单，已阻断自动映射",
        fields: [],
        limit: rule.limit ?? null,
        minVersion: rule.minVersion ?? null
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

function validateResult({ pageStructure, componentPlan, parsed }) {
  const structureTypes = pageStructure.map((item) => item.type);
  const missingCore = [];
  const requiredModulesByGoal = {
    卖货转化: ["banner", "product_grid", "cta"],
    会员拉新: ["benefit_bar", "member_form"],
    活动推广: ["banner", "event_form", "cta"]
  };

  (requiredModulesByGoal[parsed.page_goal] || []).forEach((moduleType) => {
    if (!structureTypes.includes(moduleType)) missingCore.push(moduleType);
  });

  const fallbackCount = componentPlan.filter((item) => item.status !== "direct").length;
  const unresolvedModules = componentPlan.filter((item) => item.status === "unresolved").map((item) => item.module);
  const blockedByPolicy = componentPlan.filter((item) => item.status === "unresolved" && item.reason.includes("允许清单")).map((item) => item.module);
  const limitWarnings = componentPlan
    .filter((item) => item.limit || item.minVersion)
    .map((item) => `${item.displayName}${describeConstraint(item)}`);
  const level = missingCore.length || unresolvedModules.length ? "bad" : fallbackCount > 0 ? "warn" : "ok";

  return {
    level,
    missing_components: missingCore,
    fallback_count: fallbackCount,
    unresolved_modules: unresolvedModules,
    blocked_by_component_policy: blockedByPolicy,
    checks: {
      structure_ok: missingCore.length === 0,
      content_ok: true,
      technical_ok: true
    },
    limit_warnings: limitWarnings,
    suggestions: buildSuggestions(parsed.page_goal)
  };
}

function explainDiff(componentPlan) {
  return {
    completed: componentPlan.filter((item) => item.status === "direct").map((item) => item.module),
    replaced: componentPlan
      .filter((item) => item.status === "fallback")
      .map((item) => `${item.module}（使用 ${item.displayName} 替代，备选 ${item.fallbackComponent || "无"}）`),
    unimplemented: componentPlan.filter((item) => item.status === "unresolved").map((item) => item.module),
    editable_tips: ["生成后可继续在后台换图、换商品、改跳转", "保存前检查是否触发组件上限", "如果商品列表默认空白，先点一次“查询”"]
  };
}

function buildExecutionGraph(componentPlan, parsed) {
  const pageName = `${parsed.industry}-${parsed.page_goal}-${new Date().toISOString().slice(0, 10)}`;
  const nodes = [
    { id: "open_design_list", action: "open_design_list", title: "打开微页面列表", critical: true },
    { id: "create_page", action: "create_page", title: "创建新页面", critical: true },
    { id: "set_name", action: "set_page_name", title: "填写页面名称", critical: true, payload: { pageName } }
  ];

  componentPlan
    .filter((item) => item.status !== "unresolved")
    .forEach((item, index) => {
    nodes.push({
      id: `add_component_${index + 1}`,
      action: "add_component",
      title: `添加组件：${item.displayName}`,
      payload: item,
      critical: true
    });

    if (["图文广告", "优惠券", "商品", "富文本", "链接导航"].includes(item.displayName)) {
      nodes.push({
        id: `fill_component_${index + 1}`,
        action: "fill_component",
        title: `补内容：${item.displayName}`,
        payload: item,
        critical: false
      });
    }
    });

  nodes.push({ id: "save_page", action: "save_page", title: "保存页面", critical: true });
  nodes.push({ id: "publish_page", action: "publish_page", title: "发布页面", critical: true });

  return {
    version: "v2",
    pageName,
    nodes,
    edges: nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id }))
  };
}

function buildDraftFromIntent(parsed) {
  const template = selectTemplate(parsed);
  const pageStructure = planPage(parsed, template);
  const componentPlan = mapComponents(pageStructure);
  const validation = validateResult({ pageStructure, componentPlan, parsed });
  const diff = explainDiff(componentPlan);
  const executionGraph = buildExecutionGraph(componentPlan, parsed);

  return {
    parsed,
    template,
    pageStructure,
    componentPlan,
    validation,
    diff,
    execution: {
      executor: "micro-page-state-machine",
      page_name: executionGraph.pageName,
      runtimeSelectors: {
        listPage: {
          pageUrl: "https://smp.iyouke.com/dtmall/designPage",
          urlPattern: "/dtmall/designPage",
          createButtonText: "新建页面"
        },
        editorPage: {
          pageUrl: "https://smp.iyouke.com/dtmall/pageDesign?newPage=true&platformType=1",
          urlPattern: "/dtmall/pageDesign?newPage=true"
        }
      },
      actionGraph: executionGraph,
      actionTemplate: executionGraph.nodes.map((node) => ({
        step: node.id,
        action: node.action,
        target: node.payload?.displayName || node.payload?.pageName || node.title
      }))
    }
  };
}

function detectModules(token, goal, reference) {
  const hasCoupon = token.includes("券") || token.includes("满减");
  const hasCountdown = token.includes("倒计时") || token.includes("限时");
  const hasSearch = token.includes("搜索");
  const hasLive = token.includes("直播");

  let modules;
  if (goal === "会员拉新") {
    modules = ["benefit_bar", ...(hasCoupon ? ["coupon"] : []), "member_form", "cta"];
  } else if (goal === "活动推广") {
    modules = ["banner", "benefit_bar", ...(hasSearch ? ["search_entry"] : []), ...(hasCoupon ? ["coupon"] : []), ...(hasCountdown ? ["countdown"] : []), "event_form", "cta"];
  } else {
    modules = ["banner", ...(hasSearch ? ["search_entry"] : []), "benefit_bar", ...(hasCoupon ? ["coupon"] : []), ...(hasCountdown ? ["countdown"] : []), ...(hasLive ? ["live_room"] : []), "product_grid", "cta"];
  }

  const fromReference = (reference?.hints?.modules || []).filter((m) => !modules.includes(m));
  return [...new Set([...modules, ...fromReference])];
}

function reorderByReference(pageStructure, reference) {
  const zoneModules = reference?.hints?.zoneModules;
  if (!zoneModules || !zoneModules.length) return pageStructure;

  const order = [];
  zoneModules.forEach((type) => {
    if (!order.includes(type)) order.push(type);
  });
  pageStructure.forEach((item) => {
    if (!order.includes(item.type)) order.push(item.type);
  });

  const rank = new Map(order.map((type, i) => [type, i]));
  return [...pageStructure].sort((a, b) => (rank.get(a.type) ?? 999) - (rank.get(b.type) ?? 999));
}

function describeConstraint(item) {
  const parts = [];
  if (item.limit) parts.push(`最多 ${item.limit} 个`);
  if (item.minVersion) parts.push(`最低版本 ${item.minVersion}`);
  return parts.length ? `（${parts.join("，")}）` : "";
}

function buildSuggestions(pageGoal) {
  if (pageGoal === "会员拉新") {
    return ["优先补会员权益说明和办理会员入口", "富文本补 2-3 行权益文案", "执行前确认组件限制"]; 
  }
  if (pageGoal === "活动推广") {
    return ["优先补主图、报名入口和截止提醒", "富文本补 2-3 行活动亮点", "执行前确认组件限制"];
  }
  return ["优先补图片、优惠券、商品", "链接导航至少补 1 个入口", "执行前确认组件限制"];
}

module.exports = {
  parseIntentFallback,
  buildDraftFromIntent,
  validateResult,
  explainDiff
};
