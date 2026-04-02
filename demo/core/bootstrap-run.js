export function buildBootstrapRun(pageName, designListUrl) {
  return [
    {
      step: "open_list_page",
      action: "navigate_page",
      target: designListUrl,
      success: "已打开微页面列表"
    },
    {
      step: "open_editor",
      action: "click_by_text",
      target: "新建页面",
      success: "已进入新建页编辑器"
    },
    {
      step: "set_page_name",
      action: "fill_by_placeholder",
      target: "请设置微页面名称",
      value: pageName,
      success: "页面名称已填入"
    },
    {
      step: "add_banner_component",
      action: "click_palette_component",
      target: "富文本",
      expect: "画布出现富文本组件",
      success: "第一个组件已加入画布"
    }
  ];
}
