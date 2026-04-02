import { buildBootstrapRun } from "./bootstrap-run.js";

export function buildExecutionPlan(componentPlan, parsed) {
  const pageName = `${parsed.industry}-${parsed.page_goal}-${new Date().toISOString().slice(0, 10)}`;
  const designListUrl = "https://smp.iyouke.com/dtmall/designPage";
  const directEditorUrl = "https://smp.iyouke.com/dtmall/pageDesign?newPage=true&platformType=1";

  const steps = [
    `先打开 ${designListUrl}`,
    "点击“新建页面”进入编辑器",
    `填写页面名称：${pageName}`,
    ...componentPlan.flatMap((item, index) => buildComponentSteps(item, index)),
    "点击“保存”",
    "点击“预览”并检查页面渲染"
  ];

  const mcpScript = [
    "1. navigate_page -> designPage",
    "2. click -> 新建页面",
    `3. fill -> 页面名称 = ${pageName}`,
    ...componentPlan.map((item, index) =>
      `${index + 4}. add component -> ${item.displayName}(${item.component})`
    ),
    `${componentPlan.length + 4}. click -> 保存`,
    `${componentPlan.length + 5}. click -> 预览`
  ];

  const runtimeSelectors = {
    listPage: {
      pageUrl: designListUrl,
      urlPattern: "/dtmall/designPage",
      createButtonText: "新建页面"
    },
    editorPage: {
      pageUrl: directEditorUrl,
      urlPattern: "/dtmall/pageDesign?newPage=true",
      pageSettingsTabText: "页面设置",
      componentManagementTabText: "组件管理",
      pageNameInputPlaceholder: "请设置微页面名称",
      saveButtonText: "保 存",
      previewButtonText: "预 览",
      paletteItemSelector: "li.comp"
    },
    executionRules: [
      "一律先走微页面列表页，再点击“新建页面”进入编辑器",
      "进入编辑器后优先填写页面名称，再开始加组件",
      "每次添加组件后，右侧会自动切到该组件设置",
      "需要继续改页面级信息时，先点回“页面设置”",
      "保存前至少检查一次中间画布是否出现目标组件标题"
    ]
  };

  const actionTemplate = [
    {
      step: "open_list_page",
      action: "navigate_page",
      target: runtimeSelectors.listPage.pageUrl
    },
    {
      step: "open_editor",
      action: "click_by_text",
      target: runtimeSelectors.listPage.createButtonText
    },
    {
      step: "set_page_name",
      action: "fill_by_placeholder",
      target: runtimeSelectors.editorPage.pageNameInputPlaceholder,
      value: pageName
    },
    ...componentPlan.flatMap((item, index) => [
      {
        step: `add_component_${index + 1}`,
        action: "click_palette_component",
        target: item.displayName,
        expect: `画布出现 ${index + 2}·${item.displayName}`
      },
      ...buildContentActions(item, index)
    ]),
    {
      step: "save_page",
      action: "click_by_text",
      target: runtimeSelectors.editorPage.saveButtonText
    },
    {
      step: "preview_page",
      action: "click_by_text",
      target: runtimeSelectors.editorPage.previewButtonText
    }
  ];

  const saveChecklist = [
    {
      module: "图文广告",
      check: "确认“添加图片”数量不是 0/10",
      result: "已验证可从图片管理器直接选现有素材"
    },
    {
      module: "优惠券",
      check: "确认已选优惠券数量大于 0",
      result: "已验证可打开券列表并选中第一张券"
    },
    {
      module: "商品",
      check: "确认“添加商品”数量大于 0/100",
      result: "已验证先点查询，再选第一条商品"
    },
    {
      module: "保存策略",
      check: "如仍有空模块，允许先保存草稿",
      result: "把空模块回传为待补内容，不阻断保存"
    }
  ];

  return {
    executor: "chrome-devtools-mcp",
    page_name: pageName,
    steps,
    mcpScript,
    runtimeSelectors,
    actionTemplate,
    bootstrapRun: buildBootstrapRun(pageName, designListUrl),
    saveChecklist
  };
}

function buildComponentSteps(item, index) {
  const prefix = `添加第${index + 1}个模块`;
  const steps = [
    `${prefix}：${item.module} -> ${item.displayName}(${item.component})`,
    `配置字段：${item.fields.join(" / ")}`
  ];

  const contentStep = buildContentStep(item);
  if (contentStep) steps.push(contentStep);

  return steps;
}

function buildContentStep(item) {
  if (item.displayName === "图文广告") {
    return "补内容：点“添加图片”，从图片管理器选择现有素材并确认";
  }
  if (item.displayName === "富文本") {
    return "补内容：在右侧编辑区写入默认卖点文案";
  }
  if (item.displayName === "优惠券") {
    return "补内容：点“添加优惠券”，勾选一张券并确认";
  }
  if (item.displayName === "商品") {
    return "补内容：点“添加商品”，先查询，再勾选第一条商品并确认";
  }
  if (item.displayName === "链接导航") {
    return "补内容：点“添加导航项”，先补一个默认入口";
  }
  return null;
}

function buildContentActions(item, index) {
  if (item.displayName === "图文广告") {
    return [
      {
        step: `fill_component_${index + 1}`,
        action: "material_pick",
        target: "图文广告",
        detail: [
          "点击“添加图片”",
          "选择“自定义上传”",
          "在图片管理器中点击一张现有图片",
          "点击“确定”",
          "校验按钮文案变为“添加 1/10 图片”"
        ]
      }
    ];
  }

  if (item.displayName === "优惠券") {
    return [
      {
        step: `fill_component_${index + 1}`,
        action: "coupon_pick",
        target: "优惠券",
        detail: [
          "点击“添加优惠券”",
          "勾选第一张可选优惠券",
          "点击“确定”",
          "校验画布出现优惠券样式"
        ]
      }
    ];
  }

  if (item.displayName === "商品") {
    return [
      {
        step: `fill_component_${index + 1}`,
        action: "product_pick",
        target: "商品",
        detail: [
          "点击“添加商品（0/100）”",
          "点击“查询”拉取商品列表",
          "勾选第一条商品",
          "点击“确定”",
          "校验按钮文案变为“添加商品（1/100）”"
        ]
      }
    ];
  }

  if (item.displayName === "富文本") {
    return [
      {
        step: `fill_component_${index + 1}`,
        action: "richtext_fill",
        target: "富文本",
        detail: [
          "点击富文本编辑区",
          "输入三行默认卖点文案",
          "校验画布出现对应文案",
          "确认占位提示已消失"
        ]
      }
    ];
  }

  if (item.displayName === "链接导航") {
    return [
      {
        step: `fill_component_${index + 1}`,
        action: "link_nav_fill",
        target: "链接导航",
        detail: [
          "点击“添加导航项”",
          "填写默认导航名称",
          "选择一个已有页面或默认跳转入口",
          "校验右侧按钮从 0/8 变为 1/8"
        ]
      }
    ];
  }

  return [];
}
