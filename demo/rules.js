export const MODULE_LIBRARY = {
  banner: { purpose: "传达主活动信息" },
  benefit_bar: { purpose: "强化利益点" },
  coupon: { purpose: "提升下单意愿" },
  countdown: { purpose: "制造紧迫感" },
  product_grid: { purpose: "承接商品转化" },
  member_form: { purpose: "引导用户开卡或加入会员" },
  event_form: { purpose: "引导用户预约或报名" },
  search_entry: { purpose: "给用户搜索入口" },
  live_room: { purpose: "承接直播内容或直播带货" },
  cta: { purpose: "引导用户继续点击" }
};

export const COMPONENT_DICTIONARY = {
  banner: {
    component: "banner",
    displayName: "图文广告",
    fallbackComponent: "title",
    fields: ["images", "title", "link"],
    status: "direct",
    reason: "首选 Banner 主视觉组件"
  },
  benefit_bar: {
    component: "title",
    displayName: "标题文字",
    fallbackComponent: "richtext",
    fields: ["title", "content"],
    status: "direct",
    reason: "利益点区优先用标题文字承接简短利益点"
  },
  coupon: {
    component: "coupon",
    displayName: "优惠券",
    fallbackComponent: "limit",
    fields: ["couponIds", "title"],
    status: "direct",
    reason: "可直接承接优惠券发放"
  },
  countdown: {
    component: "limit",
    displayName: "限时优惠",
    fallbackComponent: "group",
    fields: ["activityId", "title"],
    status: "direct",
    reason: "倒计时促销优先走限时优惠"
  },
  product_grid: {
    component: "product",
    displayName: "商品",
    fallbackComponent: "prodMix",
    fields: ["title", "productIds", "layout"],
    status: "direct",
    reason: "卖货页优先走标准商品组件"
  },
  member_form: {
    component: "handleMember",
    displayName: "办理会员",
    fallbackComponent: "increaseFans",
    fields: ["memberCardId", "title"],
    status: "direct",
    reason: "会员页优先走办理会员组件",
    limit: 1
  },
  event_form: {
    component: "bookEvent",
    displayName: "预约事件",
    fallbackComponent: "richtext",
    fields: ["eventId", "title"],
    status: "direct",
    reason: "活动页优先走预约事件组件"
  },
  search_entry: {
    component: "search",
    displayName: "搜索框",
    fallbackComponent: "navigation",
    fields: ["placeholder", "link"],
    status: "direct",
    reason: "搜索诉求直接映射搜索框"
  },
  live_room: {
    component: "videoChannel",
    displayName: "视频号直播",
    fallbackComponent: "video",
    fields: ["liveRoomId", "title"],
    status: "direct",
    reason: "直播诉求优先走视频号直播"
  },
  cta: {
    component: "linkNav",
    displayName: "链接导航",
    fallbackComponent: "navigation",
    fields: ["title", "links"],
    status: "direct",
    reason: "行动入口直接用链接导航",
    limit: 1
  }
};

export const PAGE_TEMPLATES = {
  sales: {
    id: "tpl_sales_v1",
    name: "卖货页模板",
    structure: [
      { type: "banner", purpose: "传达主活动信息", required: true },
      { type: "benefit_bar", purpose: "强化利益点", required: true },
      { type: "coupon", purpose: "提升下单意愿", required: false },
      { type: "countdown", purpose: "制造紧迫感", required: false },
      { type: "product_grid", purpose: "承接商品转化", required: true },
      { type: "cta", purpose: "引导立即购买", required: true }
    ]
  },
  activity: {
    id: "tpl_activity_v1",
    name: "活动页模板",
    structure: [
      { type: "banner", purpose: "活动主题", required: true },
      { type: "benefit_bar", purpose: "活动亮点", required: true },
      { type: "event_form", purpose: "活动报名入口", required: true },
      { type: "countdown", purpose: "活动截止提醒", required: false },
      { type: "cta", purpose: "引导报名/参与", required: true }
    ]
  },
  member: {
    id: "tpl_member_v1",
    name: "会员页模板",
    structure: [
      { type: "benefit_bar", purpose: "权益清单", required: true },
      { type: "member_form", purpose: "办理会员入口", required: true }
    ]
  }
};
