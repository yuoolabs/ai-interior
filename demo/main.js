const form = document.getElementById("briefForm");
const demandInput = document.getElementById("demand");
const industryInput = document.getElementById("industry");
const goalInput = document.getElementById("goal");
const styleInput = document.getElementById("style");
const themeColorModeInputs = document.querySelectorAll('input[name="themeColorMode"]');
const themeColorPicker = document.getElementById("themeColorPicker");
const customThemeColorInput = document.getElementById("customThemeColor");
const customThemeColorValue = document.getElementById("customThemeColorValue");
const referenceInput = document.getElementById("reference");
const referenceFileName = document.getElementById("referenceFileName");

const aiPanel = document.getElementById("aiPanel");
const aiFeed = document.getElementById("aiFeed");
const aiRawDetails = document.getElementById("aiRawDetails");
const aiRawOutput = document.getElementById("aiRawOutput");

const referencePanel = document.getElementById("referencePanel");
const referenceSummary = document.getElementById("referenceSummary");

const resultPanel = document.getElementById("resultPanel");
const pagePreviewPanel = document.getElementById("pagePreviewPanel");
const pagePreview = document.getElementById("pagePreview");
const details = document.getElementById("details");
const buildPanel = document.getElementById("buildPanel");

const summary = document.getElementById("summary");
const startBuildButton = document.getElementById("startBuildButton");
const structureList = document.getElementById("structureList");
const mappingList = document.getElementById("mappingList");
const validation = document.getElementById("validation");

const buildSummary = document.getElementById("buildSummary");
const buildStatus = document.getElementById("buildStatus");
const buildMeta = document.getElementById("buildMeta");
const buildSteps = document.getElementById("buildSteps");
const buildRawDetails = document.getElementById("buildRawDetails");
const buildRawOutput = document.getElementById("buildRawOutput");

let latestReferenceAnalysis = null;
let latestDraftData = null;
let latestBuildStatus = null;
let latestBuildRun = null;
let currentBuildJobId = null;
let buildPollTimer = null;

themeColorModeInputs.forEach((input) => {
  input.addEventListener("change", syncThemeColorMode);
});

customThemeColorInput.addEventListener("input", () => {
  customThemeColorValue.textContent = customThemeColorInput.value.toUpperCase();
});

referenceInput.addEventListener("change", async () => {
  referenceFileName.textContent = referenceInput.files[0]?.name || "未选择文件";
  latestReferenceAnalysis = null;
  renderReference(null);
  renderAiExperience();
});

syncThemeColorMode();
renderAiExperience();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (buildPollTimer) {
    window.clearInterval(buildPollTimer);
    buildPollTimer = null;
  }

  currentBuildJobId = null;
  latestBuildStatus = null;
  latestBuildRun = null;

  try {
    const reference = await buildReferencePayload(referenceInput.files[0]);
    const payload = {
      demand: demandInput.value,
      industry: industryInput.value,
      goal: goalInput.value,
      style: styleInput.value,
      themeColorMode: getThemeColorMode(),
      customThemeColor: customThemeColorInput.value,
      reference
    };

    const intentResponse = await fetch("/v1/intent/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!intentResponse.ok) throw new Error("意图解析失败");
    const intentData = await intentResponse.json();

    const designResponse = await fetch("/v1/design/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: intentData.parsed })
    });
    if (!designResponse.ok) throw new Error("设计生成失败");
    const designData = await designResponse.json();

    const assetsResponse = await fetch("/v1/assets/generate-and-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ design_id: designData.design_id })
    });
    if (!assetsResponse.ok) throw new Error("素材生成失败");
    const assetsData = await assetsResponse.json();

    latestReferenceAnalysis = designData.parsed?.reference_analysis || null;
    latestDraftData = {
      ...designData,
      generatedAssets: assetsData.assets || []
    };

    render(latestDraftData);
  } catch (error) {
    latestDraftData = null;
    resultPanel.hidden = true;
    details.hidden = true;
    buildPanel.hidden = true;
    latestBuildStatus = {
      state: "failed",
      message: "生成失败，请稍后重试",
      currentStep: "生成失败",
      logs: [error.message],
      events: [
        {
          stage: "runtime_execution",
          title: "生成流程失败",
          message: error.message || "unknown_error",
          status: "failed",
          kind: "warning"
        }
      ]
    };
    renderAiExperience();
  }
});

startBuildButton.addEventListener("click", async () => {
  if (!latestDraftData) return;

  const buildRun = createBuildRun(latestDraftData);
  latestBuildRun = buildRun;
  persistBuildRun(buildRun);
  startBuildButton.disabled = true;

  try {
    const response = await fetch("/v1/page/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        design_id: latestDraftData.design_id,
        draft: latestDraftData,
        auto_publish: true,
        auth_level: "service_account"
      })
    });

    if (!response.ok) {
      throw new Error("启动失败");
    }

    const result = await response.json();
    currentBuildJobId = result.run_id;
    latestBuildStatus = result;
    renderBuildRun(buildRun, latestBuildStatus);
    pollBuildStatus(buildRun);
  } catch (error) {
    latestBuildStatus = {
      state: "failed",
      message: "启动失败，请确认本地服务已启动后重试",
      logs: [error.message],
      currentStep: "启动失败",
      events: [
        {
          stage: "runtime_execution",
          title: "自动搭建启动失败",
          message: "我没能成功启动自动搭建，请检查本地服务或后台权限后重试。",
          status: "failed",
          kind: "warning",
          details: error.message
        }
      ]
    };
    renderBuildRun(buildRun, latestBuildStatus);
    startBuildButton.disabled = false;
  }
});

function render(data) {
  resultPanel.hidden = false;
  details.hidden = false;
  buildPanel.hidden = true;
  buildRawDetails.hidden = true;
  startBuildButton.disabled = false;

  summary.innerHTML = [
    renderSummaryCard("页面目标", data.parsed.page_goal),
    renderSummaryCard("风格判断", data.parsed.style),
    renderSummaryCard("主题色策略", data.parsed.theme_color_label),
    renderSummaryCard("模板选择", data.template.name),
    renderSummaryCard("可落地程度", renderBadge(data.validation.level), true),
    renderSummaryCard("参考图", data.parsed.reference_image || "未上传"),
    renderSummaryCard("AI 图片素材", data.generatedAssets?.length ? `${data.generatedAssets.length} 张` : "当前无需")
  ].join("");

  renderReference(data.parsed.reference_analysis);
  renderPagePreview(data);
  renderAiExperience();

  structureList.innerHTML = data.pageStructure
    .map((item, index) => `<li><strong>${index + 1}. ${escapeHtml(item.type)}</strong>：${escapeHtml(item.purpose)}</li>`)
    .join("");

  mappingList.innerHTML = data.componentPlan
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.module)}</strong> → ${escapeHtml(item.displayName)}（组件 key: ${escapeHtml(item.component)}；${escapeHtml(item.reason)}）</li>`
    )
    .join("");

  validation.innerHTML = [
    `<p><strong>已完成：</strong>${escapeHtml(data.diff.completed.join("、") || "无")}</p>`,
    `<p><strong>替代实现：</strong>${escapeHtml(data.diff.replaced.join("、") || "无")}</p>`,
    `<p><strong>未实现：</strong>${escapeHtml(data.diff.unimplemented.join("、") || "无")}</p>`,
    `<p><strong>限制提醒：</strong>${escapeHtml(data.validation.limit_warnings.join("；") || "无")}</p>`,
    `<p><strong>建议：</strong>${escapeHtml(data.validation.suggestions.join("；"))}</p>`
  ].join("");
}

function renderPagePreview(data) {
  if (!data?.pageStructure?.length) {
    pagePreviewPanel.hidden = true;
    pagePreview.innerHTML = "";
    return;
  }

  pagePreviewPanel.hidden = false;
  pagePreview.innerHTML = `
    <div class="page-preview-phone">
      <div class="page-preview-screen">
        <div class="page-preview-status">
          <span>09:41</span>
          <div class="page-preview-status-dots"><span></span><span></span><span></span></div>
        </div>
        <div class="page-preview-canvas">
          ${data.pageStructure.map((block, index) => renderPreviewBlock(block, index, data)).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderPreviewBlock(block, index, data) {
  const themeColor = data.parsed.theme_color_value || "#8C4B2F";
  const bannerAsset = (data.generatedAssets || []).find((item) => item.componentModule === "banner" || item.componentDisplayName === "图文广告");
  const previewProducts = createPreviewProducts(data.parsed.page_goal);

  if (block.type === "banner") {
    return `
      <section class="page-preview-block page-preview-banner">
        ${bannerAsset
          ? `<img src="${escapeHtml(bannerAsset.publicUrl)}" alt="${escapeHtml(bannerAsset.title)}" />`
          : `
            <div class="page-preview-banner-fallback" style="background: linear-gradient(145deg, ${escapeHtml(lightenHex(themeColor, 0.68))}, ${escapeHtml(lightenHex(themeColor, 0.22))});">
              <span class="page-preview-badge">${escapeHtml(data.parsed.style)}</span>
              <div class="page-preview-banner-copy">
                <strong>${escapeHtml(resolvePreviewHeadline(data.parsed.page_goal))}</strong>
                <span>${escapeHtml(data.parsed.raw_demand || "AI 正在根据需求搭建页面结构与视觉节奏。")}</span>
              </div>
            </div>`}
      </section>
    `;
  }

  if (block.type === "benefit_bar") {
    return `
      <section class="page-preview-block">
        <div class="page-preview-benefits">
          ${[
            ["限时福利", "爆款直降"],
            ["满减叠加", "券后更省"],
            ["即时承接", "下单入口"]
          ]
            .map(
              ([title, desc]) => `
                <article class="page-preview-benefit">
                  <div class="page-preview-benefit-mark" style="background:${escapeHtml(lightenHex(themeColor, 0.76))};"></div>
                  <strong>${escapeHtml(title)}</strong>
                  <span>${escapeHtml(desc)}</span>
                </article>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  if (block.type === "coupon") {
    return `
      <section class="page-preview-block">
        <div class="page-preview-coupon">
          <div>
            <strong>满 199 减 40</strong>
            <span>叠加专区商品，限今日可用</span>
          </div>
          <button type="button">立即领取</button>
        </div>
      </section>
    `;
  }

  if (block.type === "countdown") {
    return `
      <section class="page-preview-block">
        <div class="page-preview-section-title">
          <strong>限时抢购</strong>
          <span>03 : 21 : 48</span>
        </div>
      </section>
    `;
  }

  if (block.type === "product_grid") {
    return `
      <section class="page-preview-block">
        <div class="page-preview-section-title">
          <strong>AI 推荐商品</strong>
          <span>${escapeHtml(data.template.name)}</span>
        </div>
        <div class="page-preview-product-grid">
          ${previewProducts
            .map(
              (item, productIndex) => `
                <article class="page-preview-product">
                  <div class="page-preview-product-image" style="background:
                    radial-gradient(circle at 72% 22%, ${escapeHtml(lightenHex(themeColor, 0.74))} 0, transparent 34%),
                    linear-gradient(145deg, #ffffff, ${escapeHtml(lightenHex(themeColor, productIndex % 2 === 0 ? 0.88 : 0.8))});"></div>
                  <div class="page-preview-product-copy">
                    <strong>${escapeHtml(item.name)}</strong>
                    <div class="page-preview-product-meta">
                      <span class="page-preview-product-price">${escapeHtml(item.price)}</span>
                      <span class="page-preview-product-tag">${escapeHtml(item.tag)}</span>
                    </div>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  if (block.type === "search_entry") {
    return `
      <section class="page-preview-block">
        <div class="page-preview-section-title">
          <strong>搜索专区</strong>
          <span>Search</span>
        </div>
        <div class="page-preview-richtext">搜索爆款、优惠专区或品牌关键词，快速进入目标商品。</div>
      </section>
    `;
  }

  if (block.type === "live_room") {
    return `
      <section class="page-preview-block">
        <div class="page-preview-section-title">
          <strong>直播精选</strong>
          <span>Live</span>
        </div>
        <div class="page-preview-mini-grid">
          ${Array.from({ length: 4 }, (_, liveIndex) => `
            <article class="page-preview-mini-card">
              <div class="page-preview-mini-thumb" style="background:${escapeHtml(lightenHex(themeColor, 0.78 - liveIndex * 0.04))};"></div>
              <span>直播卡片 ${liveIndex + 1}</span>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  if (block.type === "member_form" || block.type === "event_form") {
    return `
      <section class="page-preview-block">
        <div class="page-preview-section-title">
          <strong>${escapeHtml(block.purpose)}</strong>
          <span>Form</span>
        </div>
        <div class="page-preview-richtext">AI 已预留表单承接位，便于后续接入会员办理或活动报名流程。</div>
      </section>
    `;
  }

  if (block.type === "cta") {
    return `
      <section class="page-preview-block">
        <div class="page-preview-cta">
          <strong>${escapeHtml(resolvePreviewHeadline(data.parsed.page_goal))}</strong>
          <button type="button">立即进入活动</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="page-preview-block">
      <div class="page-preview-section-title">
        <strong>${escapeHtml(block.type)}</strong>
        <span>${String(index + 1).padStart(2, "0")}</span>
      </div>
      <div class="page-preview-richtext">${escapeHtml(block.purpose)}</div>
    </section>
  `;
}

function createPreviewProducts(pageGoal) {
  if (pageGoal === "会员拉新") {
    return [
      { name: "会员专享洁面礼盒", price: "¥129", tag: "会员价" },
      { name: "新人加赠旅行套装", price: "¥59", tag: "新客礼" },
      { name: "加购即送护理小样", price: "¥39", tag: "加购礼" },
      { name: "年度权益组合包", price: "¥199", tag: "权益包" }
    ];
  }

  if (pageGoal === "活动推广") {
    return [
      { name: "活动主推单品", price: "¥89", tag: "报名款" },
      { name: "限时加赠专区", price: "¥69", tag: "限时" },
      { name: "参与即领体验装", price: "¥29", tag: "互动礼" },
      { name: "专题组合礼包", price: "¥149", tag: "推荐" }
    ];
  }

  return [
    { name: "爆款修护精华", price: "¥139", tag: "爆款" },
    { name: "限时直降礼盒", price: "¥199", tag: "直降" },
    { name: "高复购清洁套组", price: "¥79", tag: "热卖" },
    { name: "明星同款面霜", price: "¥159", tag: "推荐" },
    { name: "折扣专区组合", price: "¥99", tag: "满减" },
    { name: "AI 推荐加购品", price: "¥49", tag: "加购" }
  ];
}

function resolvePreviewHeadline(pageGoal) {
  if (pageGoal === "会员拉新") return "现在开卡，立刻解锁专属权益";
  if (pageGoal === "活动推广") return "活动名额有限，先报名先锁福利";
  return "限时好价上新，爆款一页直达";
}

function lightenHex(hex, amount) {
  const value = String(hex || "#8C4B2F").replace("#", "");
  const full = value.length === 3 ? value.split("").map((item) => item + item).join("") : value.padEnd(6, "0");
  const channels = full.match(/.{2}/g)?.map((item) => Number.parseInt(item, 16)) || [140, 75, 47];
  const mixed = channels.map((channel) => Math.round(channel + (255 - channel) * amount));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function renderReference(referenceAnalysis) {
  if (!referenceAnalysis) {
    referencePanel.hidden = true;
    referenceSummary.innerHTML = "";
    return;
  }

  referencePanel.hidden = false;

  referenceSummary.innerHTML = [
    `<div><strong>画面方向：</strong>${escapeHtml(referenceAnalysis.orientation)}</div>`,
    `<div><strong>主配色：</strong>${escapeHtml(referenceAnalysis.hints.paletteSummary)}</div>`,
    `<div><strong>页面风格判断：</strong>${escapeHtml(referenceAnalysis.hints.style)}</div>`,
    `<div><strong>建议页面目标：</strong>${escapeHtml(referenceAnalysis.hints.suggestedGoal)}</div>`,
    `<div><strong>建议模块：</strong>${escapeHtml(referenceAnalysis.hints.modules.join("、"))}</div>`,
    `<div><strong>区块位置判断：</strong>${escapeHtml(referenceAnalysis.hints.zoneSummary.join(" → "))}</div>`,
    `<div><strong>判断依据：</strong>${escapeHtml(referenceAnalysis.hints.reasons.join("；"))}</div>`
  ].join("");
}

function renderAiExperience() {
  if (aiPanel.hidden) {
    aiPanel.hidden = false;
  }

  const activities = [
    ...buildReferenceActivities(latestReferenceAnalysis),
    ...buildDraftActivities(latestDraftData),
    ...buildRuntimeActivities(latestBuildStatus)
  ];

  aiFeed.innerHTML = renderAiFeed(activities);
  aiRawDetails.hidden = activities.length === 0;
  aiRawOutput.textContent = activities.length ? buildAiRawOutput() : "";
}

function renderAiFeed(activities) {
  if (activities.length === 0) return "";

  const visibleActivities = activities.slice(0, 4);
  const collapsedActivities = activities.slice(4);

  return [
    visibleActivities.map(renderAiActivity).join(""),
    collapsedActivities.length ? renderAiFeedOverflow(collapsedActivities) : ""
  ].join("");
}

function renderAiFeedOverflow(activities) {
  return `
    <details class="ai-feed-overflow">
      <summary>展开更多 ${activities.length} 条 AI 动作</summary>
      <div class="ai-feed-overflow-list">
        ${activities.map(renderAiActivity).join("")}
      </div>
    </details>
  `;
}

function buildReferenceActivities(referenceAnalysis) {
  if (!referenceAnalysis) return [];

  return [
    {
      stage: "reference_analysis",
      title: "读取参考图",
      message: `我先读取了这张参考图的画面方向和主配色，整体更偏${referenceAnalysis.hints.style}风格。`,
      status: "done",
      kind: "insight",
      details: {
        orientation: referenceAnalysis.orientation,
        palette: referenceAnalysis.hints.paletteSummary,
        reasons: referenceAnalysis.hints.reasons
      }
    },
    {
      stage: "reference_analysis",
      title: "提炼复用线索",
      message: `我建议把页面目标收敛到${referenceAnalysis.hints.suggestedGoal}，并优先复用${referenceAnalysis.hints.modules.join("、")}这些模块。`,
      status: "done",
      kind: "insight",
      details: {
        modules: referenceAnalysis.hints.modules,
        zoneSummary: referenceAnalysis.hints.zoneSummary
      }
    }
  ];
}

function buildDraftActivities(data) {
  if (!data) return [];

  const fallbackCount = data.componentPlan.filter((item) => item.status !== "direct").length;
  const generatedAssets = Array.isArray(data.generatedAssets) ? data.generatedAssets : [];
  const validationStatus = data.validation.level === "ok" ? "done" : data.validation.level === "warn" ? "degraded" : "failed";
  const validationMessage =
    data.validation.level === "ok"
      ? "当前方案已经通过关键规则检查，可以直接进入自动搭建。"
      : data.validation.level === "warn"
        ? "当前方案可以继续推进，但存在替代实现或组件边界，执行时需要留意风险。"
        : "当前方案还有未覆盖项，建议先补齐缺失模块，再继续自动搭建。";

  return [
    {
      stage: "intent",
      title: "理解需求",
      message: `我把这次需求理解为一个偏${data.parsed.page_goal}的页面，风格倾向${data.parsed.style}，主题色策略采用${data.parsed.theme_color_label}。`,
      status: "done",
      kind: "insight",
      details: {
        demand: data.parsed.raw_demand,
        industry: data.parsed.industry,
        goal: data.parsed.page_goal,
        style: data.parsed.style,
        themeColor: data.parsed.theme_color_label
      }
    },
    {
      stage: "planning",
      title: "生成页面方案",
      message: `我已经排出 ${data.pageStructure.length} 个核心模块，先用 ${data.template.name} 作为页面骨架。`,
      status: "done",
      kind: "action",
      details: data.pageStructure.map((item, index) => `${index + 1}. ${item.type}：${item.purpose}`)
    },
    ...(generatedAssets.length
      ? [
          {
            stage: "visual_generation",
            title: "生成视觉素材",
            message: `我已为 ${generatedAssets.length} 个图片组件准备好 AI 素材，并把素材信息接入后续执行计划。`,
            status: "done",
            kind: "action",
            details: generatedAssets.map((asset) => ({
              component: asset.componentDisplayName,
              title: asset.title,
              promptSummary: asset.promptSummary,
              uploadStatus: asset.uploadStatusLabel || asset.uploadStatus,
              publicUrl: asset.publicUrl
            }))
          }
        ]
      : []),
    {
      stage: "mapping",
      title: "映射真实组件",
      message: fallbackCount
        ? `我已完成 ${data.componentPlan.length} 个模块的真实组件映射，其中 ${fallbackCount} 个采用了替代实现。`
        : `我已完成 ${data.componentPlan.length} 个模块的真实组件映射，当前没有发现需要降级的部分。`,
      status: fallbackCount ? "degraded" : "done",
      kind: "action",
      details: data.componentPlan.map((item) => `${item.module} -> ${item.displayName} (${item.component})`)
    },
    {
      stage: "validation",
      title: "风险判断",
      message: validationMessage,
      status: validationStatus,
      kind: data.validation.level === "ok" ? "result" : "warning",
      details: {
        missing: data.validation.missing_components,
        unresolved: data.validation.unresolved_modules,
        warnings: data.validation.limit_warnings,
        suggestions: data.validation.suggestions
      }
    },
    {
      stage: "result",
      title: "输出结果",
      message: "页面初稿已经准备好，接下来可以直接发起自动搭建，继续观察 AI 的后台动作。",
      status: "done",
      kind: "result",
      details: {
        template: data.template.name,
        moduleCount: data.pageStructure.length,
        componentCount: data.componentPlan.length
      }
    }
  ];
}

function buildRuntimeActivities(status) {
  if (!status) return [];

  if (Array.isArray(status.events) && status.events.length > 0) {
    return [...status.events]
      .sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || left.timestamp || 0);
        const rightTime = Date.parse(right.updatedAt || right.timestamp || 0);
        return leftTime - rightTime;
      })
      .map((event) => ({
      stage: event.stage || "runtime_execution",
      title: event.title || "执行动作",
      message: event.message || status.message || "",
      status: event.status || "running",
      kind: event.kind || "action",
      details: event.details ?? null
      }));
  }

  return (status.logs || []).map((item) => ({
    stage: "runtime_execution",
    title: "执行日志",
    message: item,
    status: status.state === "failed" ? "failed" : status.state === "done" ? "done" : "running",
    kind: "action",
    details: null
  }));
}

function renderAiActivity(activity) {
  const stageLabel = getStageLabel(activity.stage);
  const details = renderActivityDetails(activity);
  return `
    <article class="ai-activity ai-activity--${escapeHtml(activity.kind)} ai-activity--${escapeHtml(activity.status)}">
      <div class="ai-activity-icon" aria-hidden="true"></div>
      <div class="ai-activity-body">
        <div class="ai-activity-head">
          <span class="ai-stage">${escapeHtml(stageLabel)}</span>
          <strong class="ai-activity-title">${escapeHtml(activity.title)}</strong>
          ${renderInlineStatusBadge(activity.status)}
        </div>
        <p class="ai-activity-message">${escapeHtml(activity.message)}</p>
        ${details}
      </div>
    </article>
  `;
}

function renderActivityDetails(activity) {
  const { details, kind } = activity;
  if (!details || (Array.isArray(details) && details.length === 0)) return "";
  const summaryLabel = kind === "action" ? "查看执行细节" : kind === "result" ? "查看原始结果" : "查看判断依据";
  return `
    <details class="ai-activity-details">
      <summary>${summaryLabel}</summary>
      <pre>${escapeHtml(formatDetails(details))}</pre>
    </details>
  `;
}

function renderSummaryCard(label, value, allowHtml = false) {
  return `
    <article class="summary-card">
      <strong>${label}</strong>
      <span>${allowHtml ? value : escapeHtml(value)}</span>
    </article>
  `;
}

function renderBadge(level) {
  if (level === "ok") return '<span class="badge ok">通过</span>';
  if (level === "warn") return '<span class="badge warn">通过（有替代）</span>';
  return '<span class="badge bad">未通过</span>';
}

function renderInlineStatusBadge(status) {
  if (status === "done") return '<span class="badge ok">已完成</span>';
  if (status === "degraded") return '<span class="badge warn">已降级</span>';
  if (status === "failed") return '<span class="badge bad">失败</span>';
  return '<span class="badge warn">进行中</span>';
}

function getThemeColorMode() {
  return [...themeColorModeInputs].find((input) => input.checked)?.value || "page";
}

async function buildReferencePayload(file) {
  if (!file) return null;
  const imageDataUrl = await readFileAsDataUrl(file);
  return {
    fileName: file.name,
    mimeType: file.type || "image/*",
    imageDataUrl
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

function syncThemeColorMode() {
  const isCustom = getThemeColorMode() === "custom";
  themeColorPicker.hidden = !isCustom;
  customThemeColorValue.textContent = customThemeColorInput.value.toUpperCase();
}

function createBuildRun(data) {
  const components = data.componentPlan.map((item) => item.displayName);
  return {
    runId: `build_${Date.now()}`,
    startedAt: new Date().toLocaleString("zh-CN"),
    pageName: data.execution.page_name,
    pageGoal: data.parsed.page_goal,
    backendUrl: data.execution.runtimeSelectors.listPage.pageUrl,
    startMode: "design_list",
    components,
    generatedAssets: data.generatedAssets || [],
    steps: [
      ...(data.generatedAssets?.length ? data.generatedAssets.map((asset) => `确认 AI 素材已就绪：${asset.title}`) : []),
      "打开微页面列表",
      "点击新建页面进入编辑器",
      "填写页面名称",
      ...components.map((name) => `按顺序添加 ${name}`),
      "补默认内容",
      "保存并回列表确认"
    ],
    actionTemplate: data.execution.actionTemplate
  };
}

function persistBuildRun(buildRun) {
  localStorage.setItem("pageBuilderLatestRun", JSON.stringify(buildRun));
}

async function pollBuildStatus(buildRun) {
  if (buildPollTimer) {
    window.clearInterval(buildPollTimer);
  }

  buildPollTimer = window.setInterval(async () => {
    if (!currentBuildJobId) return;

    try {
      const response = await fetch(`/v1/runs/${encodeURIComponent(currentBuildJobId)}`);
      if (!response.ok) {
        throw new Error("状态查询失败");
      }

      latestBuildStatus = await response.json();
      renderBuildRun(buildRun, latestBuildStatus);

      if (latestBuildStatus.state === "done" || latestBuildStatus.state === "failed" || latestBuildStatus.state === "blocked") {
        window.clearInterval(buildPollTimer);
        buildPollTimer = null;
        startBuildButton.disabled = false;
      }
    } catch {
      window.clearInterval(buildPollTimer);
      buildPollTimer = null;
      startBuildButton.disabled = false;
      latestBuildStatus = {
        state: "failed",
        message: "状态查询失败，请稍后重试",
        currentStep: "状态查询失败",
        logs: ["页面无法拿到后台执行状态"],
        events: [
          {
            stage: "runtime_execution",
            title: "状态查询失败",
            message: "我无法继续拿到后台执行状态，请稍后重试。",
            status: "failed",
            kind: "warning"
          }
        ]
      };
      renderBuildRun(buildRun, latestBuildStatus);
    }
  }, 1200);
}

function renderBuildRun(buildRun, status) {
  buildPanel.hidden = false;
  buildRawDetails.hidden = false;
  latestBuildRun = buildRun;
  latestBuildStatus = status;

  const runtimeEvents = buildRuntimeActivities(status);
  const completedCount = runtimeEvents.filter((item) => item.status === "done" && item.kind !== "result").length;
  const failedCount = runtimeEvents.filter((item) => item.status === "failed").length;
  const degradedCount = runtimeEvents.filter((item) => item.status === "degraded").length;
  const filledCount = runtimeEvents.filter((item) => item.title.startsWith("补内容") && item.status === "done").length;
  const doneActions = runtimeEvents.filter((item) => item.status === "done");
  const latestDoneAction = doneActions[doneActions.length - 1];
  const attentionMessage = failedCount
    ? `${failedCount} 个动作失败，建议人工排查`
    : degradedCount
      ? `${degradedCount} 个动作降级处理`
      : "当前无需人工接手";
  const executionProgressMessage = latestDoneAction
    ? `最近完成：${latestDoneAction.title}`
    : status.state === "running"
      ? "AI 正在进入后台并准备执行"
      : "等待执行动作";
  const handoffAdvice =
    status.state === "done"
      ? "可继续进入预览或人工微调后保存。"
      : status.state === "blocked"
        ? "需要人工确认后台权限、弹窗或页面状态后继续。"
        : status.state === "failed"
          ? "建议先查看失败动作和原始细节，再决定是否重试。"
          : "保持当前页面开启，AI 会持续回报执行进展。";

  buildSummary.innerHTML = [
    renderExecutionCard("当前结果", renderBuildState(status.state, status.message), true),
    renderExecutionCard("已完成动作", `${completedCount} 个`),
    renderExecutionCard("补齐内容", `${filledCount} 个模块`),
    renderExecutionCard("人工建议", attentionMessage)
  ].join("");

  buildStatus.innerHTML = [
    `<p><strong>AI 当前动作：</strong>${escapeHtml(status.currentStep || "等待开始")}</p>`,
    `<p><strong>执行进度：</strong>${escapeHtml(executionProgressMessage)}</p>`,
    `<p><strong>执行结论：</strong>${escapeHtml(getBuildOutcome(status.state))}</p>`,
    `<p><strong>人工接手建议：</strong>${escapeHtml(handoffAdvice)}</p>`
  ].join("");

  buildMeta.innerHTML = [
    `<li><strong>任务编号：</strong>${escapeHtml(buildRun.runId)}</li>`,
    `<li><strong>开始时间：</strong>${escapeHtml(buildRun.startedAt)}</li>`,
    `<li><strong>页面目标：</strong>${escapeHtml(buildRun.pageGoal)}</li>`,
    `<li><strong>后台地址：</strong><a href="${escapeHtml(buildRun.backendUrl)}" target="_blank" rel="noreferrer">打开后台</a></li>`
  ].join("");

  buildSteps.innerHTML = buildRun.steps.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  buildRawOutput.textContent = formatDetails({
    status,
    logs: status.logs || [],
    events: status.events || [],
    buildRun,
    generatedAssets: latestDraftData?.generatedAssets || [],
    mcpScript: latestDraftData?.execution?.mcpScript || [],
    runtimeSelectors: latestDraftData?.execution?.runtimeSelectors || {},
    actionTemplate: latestDraftData?.execution?.actionTemplate || []
  });

  renderAiExperience();
}

function renderExecutionCard(label, value, allowHtml = false) {
  return `
    <article class="execution-card">
      <strong>${escapeHtml(label)}</strong>
      <span>${allowHtml ? value : escapeHtml(value)}</span>
    </article>
  `;
}

function getBuildOutcome(state) {
  if (state === "done") return "当前页面已达到可保存/可预览状态。";
  if (state === "blocked") return "当前流程被页面权限或环境限制拦住，需要人工确认后继续。";
  if (state === "failed") return "当前流程存在失败动作，建议查看原始细节定位问题。";
  return "AI 正在执行自动搭建，会持续把动作结果同步到这里。";
}

function buildAiRawOutput() {
  return formatDetails({
    referenceAnalysis: latestReferenceAnalysis
      ? {
          orientation: latestReferenceAnalysis.orientation,
          paletteSummary: latestReferenceAnalysis.hints.paletteSummary,
          style: latestReferenceAnalysis.hints.style,
          suggestedGoal: latestReferenceAnalysis.hints.suggestedGoal,
          modules: latestReferenceAnalysis.hints.modules,
          reasons: latestReferenceAnalysis.hints.reasons
        }
      : null,
    parsed: latestDraftData?.parsed || null,
    template: latestDraftData?.template?.name || null,
    pageStructure: latestDraftData?.pageStructure || [],
    componentPlan: latestDraftData?.componentPlan || [],
    generatedAssets: latestDraftData?.generatedAssets || [],
    validation: latestDraftData?.validation || null,
    runtimeStatus: latestBuildStatus
      ? {
          state: latestBuildStatus.state,
          currentStep: latestBuildStatus.currentStep,
          message: latestBuildStatus.message,
          eventCount: (latestBuildStatus.events || []).length
        }
      : null
  });
}

function getStageLabel(stage) {
  if (stage === "intent") return "理解需求";
  if (stage === "reference_analysis") return "分析参考图";
  if (stage === "planning") return "生成页面方案";
  if (stage === "visual_generation") return "生成视觉素材";
  if (stage === "mapping") return "映射真实组件";
  if (stage === "validation") return "风险判断";
  if (stage === "result") return "输出结果";
  if (stage === "runtime_execution") return "执行自动搭建";
  return "执行动作";
}

function formatDetails(details) {
  if (typeof details === "string") return details;
  if (Array.isArray(details)) return details.map((item) => (typeof item === "string" ? item : JSON.stringify(item, null, 2))).join("\n");
  return JSON.stringify(details, null, 2);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderBuildState(state, message) {
  if (state === "done") return `<span class="badge ok">${escapeHtml(message || "已完成")}</span>`;
  if (state === "running") return `<span class="badge warn">${escapeHtml(message || "执行中")}</span>`;
  if (state === "blocked") return `<span class="badge warn">${escapeHtml(message || "需要处理")}</span>`;
  if (state === "failed") return `<span class="badge bad">${escapeHtml(message || "失败")}</span>`;
  return `<span class="badge warn">${escapeHtml(message || "准备中")}</span>`;
}
