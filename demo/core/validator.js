export function validateResult({ pageStructure, componentPlan, parsed }) {
  const structureTypes = pageStructure.map((item) => item.type);
  const missingCore = [];
  const requiredModulesByGoal = {
    卖货转化: ["banner", "product_grid", "cta"],
    会员拉新: ["benefit_bar", "member_form"],
    活动推广: ["banner", "event_form", "cta"]
  };

  (requiredModulesByGoal[parsed.page_goal] || []).forEach((moduleType) => {
    if (!structureTypes.includes(moduleType)) {
      missingCore.push(moduleType);
    }
  });

  const fallbackCount = componentPlan.filter((item) => item.status !== "direct").length;
  const unresolvedModules = componentPlan.filter((item) => item.status === "unresolved").map((item) => item.module);
  const limitWarnings = componentPlan
    .filter((item) => item.limit || item.minVersion)
    .map((item) => `${item.displayName}${describeConstraint(item)}`);

  const level = missingCore.length || unresolvedModules.length ? "bad" : fallbackCount > 0 ? "warn" : "ok";

  return {
    level,
    missing_components: missingCore,
    fallback_count: fallbackCount,
    unresolved_modules: unresolvedModules,
    checks: {
      structure_ok: missingCore.length === 0,
      content_ok: true,
      technical_ok: true
    },
    limit_warnings: limitWarnings,
    suggestions: buildSuggestions(parsed.page_goal)
  };
}

export function validateRuntimeDraft(runtimeDraft) {
  const emptyModules = [];
  const widgets = runtimeDraft?.widgets || [];

  widgets.forEach((widget) => {
    if (widget.type === "banner" && Array.isArray(widget.setting?.banner) && widget.setting.banner.length === 0) {
      emptyModules.push("图文广告未添加图片");
    }
    if (widget.type === "coupon" && Array.isArray(widget.setting?.couponItems) && widget.setting.couponItems.length === 0) {
      emptyModules.push("优惠券未添加券");
    }
    if (widget.type === "product" && Array.isArray(widget.setting?.prods?.prodList) && widget.setting.prods.prodList.length === 0) {
      emptyModules.push("商品未添加商品数据");
    }
    if (widget.type === "richtext" && !widget.setting?.content) {
      emptyModules.push("富文本未填写默认文案");
    }
  });

  return {
    canSaveDirectly: true,
    saveMode: emptyModules.length === 0 ? "ready" : "draft",
    emptyModules,
    filledModules: [
      "图文广告可从图片管理器直接选现有素材",
      "优惠券可从券列表直接勾选",
      "商品可查询后直接勾选现有商品",
      "富文本可直接在右侧编辑区输入默认文案"
    ]
  };
}

export function explainDiff(componentPlan) {
  return {
    completed: componentPlan.filter((item) => item.status === "direct").map((item) => item.module),
    replaced: componentPlan
      .filter((item) => item.status === "fallback")
      .map((item) => `${item.module}（使用 ${item.displayName} 替代，备选 ${item.fallbackComponent || "无"}）`),
    unimplemented: componentPlan.filter((item) => item.status === "unresolved").map((item) => item.module),
    editable_tips: ["生成后可继续在后台换图、换商品、改跳转", "保存前检查是否触发组件上限", "如果商品列表默认空白，先点一次“查询”"]
  };
}

function describeConstraint(item) {
  const parts = [];
  if (item.limit) parts.push(`最多 ${item.limit} 个`);
  if (item.minVersion) parts.push(`最低版本 ${item.minVersion}`);
  return parts.length ? `（${parts.join("，")}）` : "";
}

function buildSuggestions(pageGoal) {
  if (pageGoal === "会员拉新") {
    return [
      "优先补会员权益说明和办理会员入口，避免先堆空模块",
      "富文本至少补 2 到 3 行会员权益说明，避免出现空白说明区",
      "如果参考图里没有明显底部入口，不强行补链接导航",
      "替换示例文案为真实会员权益和价格信息",
      "执行前确认组件数量和版本限制"
    ];
  }

  if (pageGoal === "活动推广") {
    return [
      "优先补活动主图、报名入口和截止提醒，再统一保存",
      "富文本至少补 2 到 3 行活动亮点，避免出现空白说明区",
      "如果报名组件无法配置，先降级到文本说明加入口引导",
      "替换示例文案为真实活动信息",
      "执行前确认组件数量和版本限制"
    ];
  }

  return [
    "优先自动补图片、优惠券、商品，再统一保存",
    "富文本至少补 2 到 3 行活动卖点，避免出现空白说明区",
    "链接导航至少补 1 个入口，避免底部只有占位模块",
    "替换示例文案为真实活动信息",
    "执行前确认组件数量和版本限制"
  ];
}
