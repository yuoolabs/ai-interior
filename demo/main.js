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
const requireModelToggle = document.getElementById("requireModelToggle");

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
const runtimeConfigForm = document.getElementById("runtimeConfigForm");
const cfgModelProvider = document.getElementById("cfgModelProvider");
const cfgModelName = document.getElementById("cfgModelName");
const cfgModelBaseUrl = document.getElementById("cfgModelBaseUrl");
const cfgModelApiKey = document.getElementById("cfgModelApiKey");
const cfgAdapterMode = document.getElementById("cfgAdapterMode");
const cfgApiBase = document.getElementById("cfgApiBase");
const cfgApiToken = document.getElementById("cfgApiToken");
const runtimeConfigStatus = document.getElementById("runtimeConfigStatus");
const runPreflightButton = document.getElementById("runPreflightButton");
const runtimePreflightSummary = document.getElementById("runtimePreflightSummary");

let latestReferenceAnalysis = null;
let latestDraftData = null;
let latestBuildStatus = null;
let latestBuildRun = null;
let currentBuildJobId = null;
let buildPollTimer = null;
let componentSkinCatalog = null;
let latestSystemConfig = null;
let latestPreflight = null;

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
demandInput.addEventListener("input", () => {
  syncStartBuildAvailability();
});

syncThemeColorMode();
renderAiExperience();
loadComponentSkinCatalog();
loadSystemConfig().then(() => runPreflightCheck({ strict: true, silent: true }));
syncStartBuildAvailability();
restoreRequireModelPreference();

if (runtimeConfigForm) {
  runtimeConfigForm.addEventListener("submit", saveRuntimeConfig);
}
if (runPreflightButton) {
  runPreflightButton.addEventListener("click", () => runPreflightCheck({ strict: true, silent: false }));
}

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
      reference,
      require_model: getRequireModelEnabled()
    };

    const intentData = await postJson("/v1/intent/parse", payload, "意图解析失败");
    const designData = await postJson("/v1/design/generate", { intent: intentData.parsed, require_model: getRequireModelEnabled() }, "设计生成失败");
    const assetsData = await postJson("/v1/assets/generate-and-upload", { design_id: designData.design_id }, "素材生成失败");

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
  if (!String(demandInput.value || "").trim()) {
    latestBuildStatus = {
      state: "failed",
      message: "请先输入页面需求",
      currentStep: "等待输入需求",
      logs: ["页面需求为空，无法启动自动搭建"],
      events: [
        {
          stage: "runtime_execution",
          title: "启动前校验失败",
          message: "请先输入页面需求",
          status: "failed",
          kind: "warning"
        }
      ]
    };
    renderAiExperience();
    return;
  }

  startBuildButton.disabled = true;
  startBuildButton.textContent = "AI 正在生成并执行...";

  const pendingBuildRun = createBuildRun(latestDraftData || createDraftFallbackFromForm(), null);
  latestBuildRun = pendingBuildRun;
  persistBuildRun(pendingBuildRun);
  latestBuildStatus = {
    state: "running",
    message: "请求已发送，AI 正在生成设计稿并启动自动搭建",
    currentStep: "提交自动搭建请求",
    logs: ["已发送 /v1/page/auto-build 请求"],
    events: [
      {
        stage: "runtime_execution",
        title: "请求已提交",
        message: "AI 正在生成设计稿并准备执行，请稍候（首次可能需要 10-30 秒）",
        status: "running",
        kind: "insight"
      }
    ]
  };
  renderBuildRun(pendingBuildRun, latestBuildStatus);

  try {
    const runtimeMode = await ensureRuntimeModeReadyForBuild();
    if (runtimeMode === "ui_only") {
      latestBuildStatus = {
        state: "running",
        message: "当前为 UI 自动化模式，AI 将尝试直接在后台界面执行创建",
        currentStep: "准备 UI 自动化执行",
        logs: ["MICROPAGE_ADAPTER_MODE=ui_only"],
        events: [
          {
            stage: "runtime_execution",
            title: "执行模式确认",
            message: "检测到 UI 自动化模式，已跳过 API 创建链路。",
            status: "running",
            kind: "insight"
          }
        ]
      };
      renderBuildRun(pendingBuildRun, latestBuildStatus);
    }

    const reference = await buildReferencePayload(referenceInput.files[0]);
    const payload = {
      demand: demandInput.value,
      industry: industryInput.value,
      goal: goalInput.value,
      style: styleInput.value,
      themeColorMode: getThemeColorMode(),
      customThemeColor: customThemeColorInput.value,
      reference,
      require_model: getRequireModelEnabled(),
      auto_publish: true,
      auth_level: "service_account"
    };

    const result = await postJson("/v1/page/auto-build", payload, "启动失败");
    const returnedDraft = normalizeDraftFromAutoBuild(result);
    if (returnedDraft) {
      latestReferenceAnalysis = returnedDraft.parsed?.reference_analysis || null;
      latestDraftData = returnedDraft;
      render(latestDraftData);
      startBuildButton.disabled = true;
    }

    const buildRun = createBuildRun(latestDraftData || returnedDraft || {}, result.run_id);
    latestBuildRun = buildRun;
    persistBuildRun(buildRun);

    currentBuildJobId = result.run_id;
    latestBuildStatus = result.execute || {
      run_id: result.run_id,
      state: result.state || "running",
      message: "已开始自动执行",
      currentStep: "准备执行",
      events: []
    };
    renderBuildRun(buildRun, latestBuildStatus);
    pollBuildStatus(buildRun);
  } catch (error) {
    const buildRun = createBuildRun(latestDraftData || {}, null);
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
    syncStartBuildAvailability();
    startBuildButton.textContent = "自动搭建并发布";
  }
});

function render(data) {
  resultPanel.hidden = false;
  details.hidden = false;
  buildPanel.hidden = true;
  buildRawDetails.hidden = true;
  syncStartBuildAvailability();

  summary.innerHTML = [
    renderSummaryCard("页面目标", data.parsed.page_goal),
    renderSummaryCard("风格判断", data.parsed.style),
    renderSummaryCard("主题色策略", data.parsed.theme_color_label),
    renderSummaryCard("模板选择", data.template.name),
    renderSummaryCard("AI 生成状态", renderAiGenerationState(data), true),
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
  const previewComponents = buildPreviewComponents(data);
  if (!previewComponents.length) {
    pagePreviewPanel.hidden = true;
    pagePreview.innerHTML = "";
    return;
  }

  const previewTheme = resolvePreviewTheme(data);
  pagePreviewPanel.hidden = false;
  const skinSummary = componentSkinCatalog?.summary;
  const skinHint = skinSummary
    ? `已配置组件皮肤 ${skinSummary.withScreenshot}/${skinSummary.total}`
    : "组件皮肤配置加载中";
  pagePreview.innerHTML = `
    <div class="page-preview-phone">
      <div class="page-preview-screen">
        <div class="page-preview-status">
          <span>组件样式预估</span>
          <div class="page-preview-status-dots"><span></span><span></span><span></span></div>
        </div>
        <div class="page-preview-canvas" style="background: linear-gradient(180deg, ${escapeHtml(previewTheme.surfaceStart)}, ${escapeHtml(previewTheme.surfaceEnd)});">
          <div class="page-preview-meta">按后台组件 key 渲染：${escapeHtml(previewComponents.map((item) => item.component).join("、"))}<br/>${escapeHtml(skinHint)}</div>
          ${previewComponents.map((component, index) => renderPreviewComponent(component, index, data, previewTheme)).join("")}
        </div>
      </div>
    </div>
  `;
}

function buildPreviewComponents(data) {
  const componentPlan = Array.isArray(data?.componentPlan) ? data.componentPlan : [];
  if (componentPlan.length) return componentPlan;
  const pageStructure = Array.isArray(data?.pageStructure) ? data.pageStructure : [];
  return pageStructure.map((block) => ({
    module: block.type,
    component: block.type,
    displayName: block.type,
    status: "fallback",
    reason: block.purpose,
    fields: []
  }));
}

function renderPreviewComponent(component, index, data, previewTheme) {
  const themeColor = data.parsed.theme_color_value || "#8C4B2F";
  const bannerAsset = (data.generatedAssets || []).find((item) => item.componentModule === "banner" || item.componentDisplayName === "图文广告");
  const previewProducts = createPreviewProducts(data.parsed.page_goal, data.parsed.raw_demand, data.parsed.style);
  const stateLabel = resolveComponentStateLabel(component.status);
  const reasonText = component.reason || "已使用组件默认配置";
  const skin = resolveComponentSkin(component.component);
  const primaryTone = previewTheme?.primary || themeColor;
  const secondaryTone = previewTheme?.secondary || lightenHex(themeColor, 0.74);
  const copy = data.copyDraft || {};
  const fieldChips = Array.isArray(component.fields) && component.fields.length
    ? component.fields.map((field) => `<span class="page-preview-field-chip">${escapeHtml(field)}</span>`).join("")
    : `<span class="page-preview-field-chip">默认字段</span>`;

  let body = "";
  if (skin?.screenshot) {
    const slots = (skin.slots || []).length
      ? `<div class="page-preview-skin-slots">${skin.slots.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
      : "";
    body = `
      <div class="page-preview-skin-frame">
        <img src="${escapeHtml(skin.screenshot)}" alt="${escapeHtml(`${skin.name || component.displayName} 真实组件截图`)}" style="object-fit:${escapeHtml(skin.fit || "cover")};" />
      </div>
      ${slots}
      ${skin.notes ? `<div class="page-preview-skin-note">${escapeHtml(skin.notes)}</div>` : ""}
    `;
  } else if (skin && !skin.available) {
    body = `<div class="page-preview-placeholder">组件皮肤已配置但截图未找到：${escapeHtml(skin.screenshot || "未设置路径")}</div>`;
  }

  if (!body && component.component === "banner") {
    body = bannerAsset
      ? `<div class="page-preview-banner-stage"><img src="${escapeHtml(bannerAsset.publicUrl)}" alt="${escapeHtml(bannerAsset.title)}" /></div>`
      : `<div class="page-preview-banner-fallback" style="background: linear-gradient(145deg, ${escapeHtml(lightenHex(secondaryTone, 0.42))}, ${escapeHtml(lightenHex(primaryTone, 0.12))});">
          <span class="page-preview-badge">${escapeHtml(data.parsed.style)}</span>
          <div class="page-preview-banner-copy">
            <strong>${escapeHtml(copy.headline || resolvePreviewHeadline(data.parsed.page_goal))}</strong>
            <span>${escapeHtml(copy.subheadline || data.parsed.raw_demand || "等待素材生成后自动填充主图")}</span>
          </div>
          <button type="button" class="page-preview-nav-item">${escapeHtml(copy.cta || "立即查看")}</button>
        </div>`;
  } else if (!body && component.component === "coupon") {
    const couponText = resolveCouponPreview(data.parsed.raw_demand, data.parsed.style);
    body = `
      <div class="page-preview-coupon">
        <div>
          <strong>${escapeHtml(couponText)}</strong>
          <span>组件：coupon，支持批量券包回填</span>
        </div>
        <button type="button">去领取</button>
      </div>
    `;
  } else if (!body && component.component === "product") {
    body = `
      <div class="page-preview-product-grid">
        ${previewProducts
          .slice(0, 4)
          .map(
            (item, productIndex) => `
              <article class="page-preview-product">
                <div class="page-preview-product-image" style="background:
                  radial-gradient(circle at 72% 22%, ${escapeHtml(lightenHex(secondaryTone, 0.54))} 0, transparent 34%),
                  linear-gradient(145deg, #ffffff, ${escapeHtml(lightenHex(primaryTone, productIndex % 2 === 0 ? 0.88 : 0.8))});"></div>
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
    `;
  } else if (!body && component.component === "search") {
    body = `
      <div class="page-preview-search">
        <span>搜索框组件</span>
        <strong>${escapeHtml(resolveSearchHint(data.parsed.raw_demand))}</strong>
      </div>
    `;
  } else if (!body && component.component === "linkNav") {
    const navItems = resolveNavItems(data.parsed.raw_demand, data.parsed.page_goal);
    body = `
      <div class="page-preview-nav-grid">
        ${navItems.map((item) => `<button type="button" class="page-preview-nav-item">${escapeHtml(item)}</button>`).join("")}
      </div>
    `;
  } else if (!body && component.component === "limit") {
    body = `
      <div class="page-preview-section-title">
        <strong>限时优惠组件</strong>
        <span>03 : 21 : 48</span>
      </div>
    `;
  } else if (!body && component.component === "title") {
    body = `
      <div class="page-preview-richtext">
        <strong>标题文字组件</strong><br/>
        用于承接利益点、分区标题或说明文案。
      </div>
    `;
  } else if (!body && (component.component === "handleMember" || component.component === "bookEvent")) {
    body = `
      <div class="page-preview-form-card">
        <strong>${escapeHtml(component.displayName)}</strong>
        <span>${escapeHtml(copy.subheadline || "组件已预留业务 ID 与跳转配置位")}</span>
        <button type="button">${escapeHtml(copy.cta || (component.component === "handleMember" ? "立即开通会员" : "立即报名活动"))}</button>
      </div>
    `;
  } else if (!body && component.component === "videoChannel") {
    body = `
      <div class="page-preview-mini-grid">
        ${Array.from({ length: 4 }, (_, liveIndex) => `
          <article class="page-preview-mini-card">
            <div class="page-preview-mini-thumb" style="background:${escapeHtml(lightenHex(primaryTone, 0.78 - liveIndex * 0.04))};"></div>
            <span>直播卡片 ${liveIndex + 1}</span>
          </article>
        `).join("")}
      </div>
    `;
  } else if (!body) {
    body = `<div class="page-preview-placeholder">${escapeHtml(reasonText)}</div>`;
  }

  return `
    <section class="page-preview-block page-preview-component ${component.status === "unresolved" ? "page-preview-component--unresolved" : ""}" style="border-color:${escapeHtml(lightenHex(primaryTone, 0.62))};">
      <div class="page-preview-component-head">
        <div class="page-preview-component-title">
          <strong>${escapeHtml(component.displayName || `组件 ${index + 1}`)}</strong>
          <span>key: ${escapeHtml(component.component || "unknown")} · module: ${escapeHtml(component.module || "-")}</span>
        </div>
        <span class="page-preview-component-state">${escapeHtml(stateLabel)}</span>
      </div>
      ${body}
      <div class="page-preview-field-chips">${fieldChips}</div>
    </section>
  `;
}

function resolveComponentStateLabel(status) {
  if (status === "direct") return "可自动落地";
  if (status === "fallback") return "降级映射";
  if (status === "unresolved") return "需人工处理";
  return "待确认";
}

function resolveComponentSkin(componentKey) {
  if (!componentSkinCatalog?.components || !componentKey) return null;
  return componentSkinCatalog.components[componentKey] || null;
}

async function loadComponentSkinCatalog() {
  try {
    const response = await fetch("/v1/system/component-skins");
    if (!response.ok) return;
    const data = await response.json();
    componentSkinCatalog = data?.skins || null;
    if (latestDraftData) {
      renderPagePreview(latestDraftData);
    }
  } catch {
    componentSkinCatalog = null;
  }
}

async function loadSystemConfig() {
  try {
    const response = await fetch("/v1/system/config");
    if (!response.ok) return;
    const data = await response.json();
    latestSystemConfig = data?.system || null;
    renderRuntimeConfigForm(latestSystemConfig);
  } catch {
    latestSystemConfig = null;
  }
}

async function saveRuntimeConfig(event) {
  event.preventDefault();
  if (!runtimeConfigForm) return;

  const payload = {
    model: {
      provider: cfgModelProvider?.value || "",
      name: cfgModelName?.value || "",
      baseUrl: cfgModelBaseUrl?.value || "",
      apiKey: cfgModelApiKey?.value || ""
    },
    adapter: {
      mode: cfgAdapterMode?.value || "",
      apiBase: cfgApiBase?.value || "",
      apiToken: cfgApiToken?.value || ""
    }
  };

  try {
    const saveButton = document.getElementById("saveRuntimeConfigButton");
    if (saveButton) saveButton.disabled = true;
    setRuntimeConfigStatus("正在保存配置...", false);

    const response = await fetch("/v1/system/config/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("配置保存失败");

    const data = await response.json();
    latestSystemConfig = data?.system || null;
    renderRuntimeConfigForm(latestSystemConfig);
    cfgModelApiKey.value = "";
    cfgApiToken.value = "";
    await runPreflightCheck({ strict: true, silent: true });
    setRuntimeConfigStatus(
      `已保存并生效：provider=${latestSystemConfig?.model?.provider || "-"}，mode=${latestSystemConfig?.adapter?.mode || "-"}，预检=${latestPreflight?.ok ? "通过" : "未通过"}`,
      !latestPreflight?.ok
    );
    syncStartBuildAvailability();
  } catch (error) {
    setRuntimeConfigStatus(`保存失败：${error.message || "unknown_error"}`, true);
  } finally {
    const saveButton = document.getElementById("saveRuntimeConfigButton");
    if (saveButton) saveButton.disabled = false;
  }
}

function renderRuntimeConfigForm(systemConfig) {
  if (!runtimeConfigForm) return;
  const model = systemConfig?.model || {};
  const adapter = systemConfig?.adapter || {};

  if (cfgModelProvider) cfgModelProvider.value = String(model.provider || "gemini");
  if (cfgModelName) cfgModelName.value = String(model.name || "");
  if (cfgModelBaseUrl) cfgModelBaseUrl.value = String(model.baseUrl || "");
  if (cfgAdapterMode) cfgAdapterMode.value = String(adapter.mode || "ui_only");
  if (cfgApiBase) cfgApiBase.value = String(adapter.apiBase || "");
  if (cfgApiToken) cfgApiToken.value = "";
  setRuntimeConfigStatus(
    `当前运行态：provider=${model.provider || "-"}，mode=${adapter.mode || "-"}，hasApiKey=${model.hasApiKey ? "true" : "false"}`,
    false
  );
  renderRuntimeDiagnostics();
}

function setRuntimeConfigStatus(message, isError) {
  if (!runtimeConfigStatus) return;
  runtimeConfigStatus.textContent = message;
  runtimeConfigStatus.style.color = isError ? "#b42318" : "";
}

async function postJson(url, payload, fallbackMessage = "请求失败") {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || fallbackMessage);
  }
  return data;
}

function getRequireModelEnabled() {
  return Boolean(requireModelToggle?.checked);
}

function restoreRequireModelPreference() {
  if (!requireModelToggle) return;
  const stored = localStorage.getItem("requireModelToggle");
  if (stored === "0") requireModelToggle.checked = false;
  requireModelToggle.addEventListener("change", () => {
    localStorage.setItem("requireModelToggle", requireModelToggle.checked ? "1" : "0");
  });
}

async function runPreflightCheck({ strict = true, silent = false } = {}) {
  try {
    if (runPreflightButton) runPreflightButton.disabled = true;
    const response = await fetch("/v1/system/preflight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strict })
    });
    if (!response.ok) {
      throw new Error(`preflight_request_failed:${response.status}`);
    }
    latestPreflight = await response.json();
    renderRuntimeDiagnostics();

    if (!silent) {
      setRuntimeConfigStatus(
        latestPreflight.ok ? "系统预检通过，可执行自动搭建。" : "系统预检未通过，请先根据下方检查项修复。",
        !latestPreflight.ok
      );
    }
    return latestPreflight;
  } catch (error) {
    latestPreflight = {
      ok: false,
      checks: [
        {
          name: "preflight_request",
          ok: false,
          message: error.message || "预检请求失败"
        }
      ]
    };
    renderRuntimeDiagnostics();
    if (!silent) {
      setRuntimeConfigStatus(`预检失败：${error.message || "unknown_error"}`, true);
    }
    return latestPreflight;
  } finally {
    if (runPreflightButton) runPreflightButton.disabled = false;
  }
}

function renderRuntimeDiagnostics() {
  if (!runtimePreflightSummary) return;
  const model = latestSystemConfig?.model || {};
  const adapter = latestSystemConfig?.adapter || {};
  const rollout = latestSystemConfig?.rollout || {};
  const preflight = latestPreflight;
  const checks = Array.isArray(preflight?.checks) ? preflight.checks : [];
  const modelChecks = Array.isArray(preflight?.model?.checks) ? preflight.model.checks : [];
  const mergedChecks = [
    ...checks.map((item) => ({ ...item, name: `adapter.${item.name || "check"}` })),
    ...modelChecks.map((item) => ({ ...item, name: `model.${item.name || "check"}` }))
  ];

  const checkHtml = mergedChecks.length
    ? mergedChecks
        .map((item) => `<li><span class="${item.ok ? "ok" : "bad"}">${item.ok ? "通过" : "失败"}</span> · ${escapeHtml(item.name || "check")}：${escapeHtml(item.message || "")}</li>`)
        .join("")
    : `<li><span class="bad">未执行</span> · 还没有预检结果</li>`;

  const tenantAllowlist = Array.isArray(rollout.tenantAllowlist) && rollout.tenantAllowlist.length
    ? rollout.tenantAllowlist.join(", ")
    : "未设置";
  const uiOnlyHint = adapter.mode === "ui_only"
    ? "UI 自动化模式下，请保持浏览器前台并授权系统自动化控制（macOS 需在系统设置允许终端/Node 控制浏览器）。"
    : "";

  runtimePreflightSummary.innerHTML = `
    <div class="runtime-preflight-head">
      <strong>可执行性诊断</strong>
      ${preflight ? renderInlineStatusBadge(preflight.ok ? "done" : "failed") : renderInlineStatusBadge("running")}
    </div>
    <p class="runtime-preflight-text">模型：${escapeHtml(model.provider || "-")} / ${escapeHtml(model.name || "-")}；有无 Key：${model.hasApiKey ? "是" : "否"}；Base URL：${escapeHtml(model.baseUrl || "-")}</p>
    <p class="runtime-preflight-text">模式：${escapeHtml(adapter.mode || "-")}；API Base：${adapter.apiBaseSet ? "已配置" : "未配置"}；API Token：${adapter.apiTokenSet ? "已配置" : "未配置"}</p>
    <p class="runtime-preflight-text">发布策略：自动发布总开关=${rollout.enableRealAutoPublish ? "开" : "关"}；租户白名单=${escapeHtml(tenantAllowlist)}</p>
    ${uiOnlyHint ? `<p class="runtime-preflight-text">${escapeHtml(uiOnlyHint)}</p>` : ""}
    <ul class="runtime-preflight-list">${checkHtml}</ul>
  `;
}

async function ensureRuntimeModeReadyForBuild() {
  await loadSystemConfig();
  const preflight = await runPreflightCheck({ strict: true, silent: true });
  const adapter = latestSystemConfig?.adapter || {};
  const mode = String(adapter.mode || "mock");
  const apiBaseSet = Boolean(adapter.apiBaseSet);
  const apiTokenSet = Boolean(adapter.apiTokenSet);

  if (mode === "mock") {
    throw new Error("当前运行在 mock 模式：只会模拟执行，不会真实创建微页面。请切换到 real 或 ui_only 模式。");
  }

  if (mode === "real" && (!apiBaseSet || !apiTokenSet)) {
    throw new Error("当前是 real 模式但缺少 MICROPAGE_API_BASE 或 MICROPAGE_API_TOKEN，无法真实创建微页面。");
  }

  if (mode === "real" && preflight && !preflight.ok) {
    const failedChecks = (preflight.checks || [])
      .filter((item) => item && item.ok === false)
      .map((item) => item.message)
      .filter(Boolean);
    throw new Error(`real 模式预检未通过：${failedChecks.join("；") || "请检查系统配置"}`);
  }

  if (getRequireModelEnabled() && preflight?.model && !preflight.model.ok) {
    const modelErrors = (preflight.model.checks || [])
      .filter((item) => item && item.ok === false)
      .map((item) => item.message)
      .filter(Boolean);
    throw new Error(`当前启用了“必须使用大模型”，但模型预检失败：${modelErrors.join("；") || "请检查模型网关与 API Key"}`);
  }

  return mode;
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

function resolvePreviewTheme(data) {
  const base = data?.parsed?.theme_color_value || "#8C4B2F";
  const style = String(data?.parsed?.style || "").trim();
  if (style.includes("大促")) {
    return {
      primary: "#B42318",
      secondary: lightenHex("#B42318", 0.58),
      surfaceStart: "#fff7f5",
      surfaceEnd: "#ffe8e1"
    };
  }
  if (style.includes("清新")) {
    return {
      primary: "#0F766E",
      secondary: lightenHex("#0F766E", 0.55),
      surfaceStart: "#f3fffb",
      surfaceEnd: "#def7ef"
    };
  }
  return {
    primary: base,
    secondary: lightenHex(base, 0.48),
    surfaceStart: lightenHex(base, 0.93),
    surfaceEnd: lightenHex(base, 0.84)
  };
}

function resolveCouponPreview(demand, style) {
  const token = String(demand || "");
  const explicit = token.match(/满\s*([0-9]{2,4})\s*减\s*([0-9]{1,4})/);
  if (explicit) return `满 ${explicit[1]} 减 ${explicit[2]}`;
  if (token.includes("双十一")) return "满 399 减 120";
  if (token.includes("团购")) return "2 件 8 折 · 3 件 7 折";
  if (String(style || "").includes("大促")) return "满 299 减 80";
  return "满 199 减 40";
}

function resolveSearchHint(demand) {
  const token = String(demand || "");
  if (token.includes("母婴")) return "搜索母婴爆款";
  if (token.includes("美妆")) return "搜索美妆爆款";
  if (token.includes("双十一")) return "搜索双十一会场商品";
  return "请输入商品关键词";
}

function resolveNavItems(demand, goal) {
  const token = String(demand || "");
  if (token.includes("团购")) return ["团购专区", "优惠会场", "限时秒杀", "新客专享"];
  if (goal === "会员拉新") return ["会员权益", "开卡有礼", "积分兑换", "品牌故事"];
  if (goal === "活动推广") return ["活动日程", "报名入口", "活动规则", "往期回顾"];
  return ["爆款专区", "优惠会场", "新品首发", "品牌故事"];
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

  const intentFallback = Boolean(data.parsed?.model_fallback);
  const blueprintFallback = Boolean(data.designBlueprint?.modelFallback);
  const copyFallback = Boolean(data.copyDraft?.modelFallback);
  const hasModelFallback = intentFallback || blueprintFallback || copyFallback;
  const fallbackReasons = [
    data.parsed?.model_fallback_reason,
    data.designBlueprint?.modelFallbackReason,
    data.copyDraft?.modelFallbackReason
  ]
    .filter((item) => Boolean(String(item || "").trim()))
    .filter((item, index, arr) => arr.indexOf(item) === index);

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
    },
    ...(hasModelFallback
      ? [
          {
            stage: "validation",
            title: "模型调用降级提醒",
            message: `本次请求部分环节未成功调用大模型，已自动降级到规则模板，因此不同提示词的页面差异会变小。`,
            status: "degraded",
            kind: "warning",
            details: {
              intentFallback,
              blueprintFallback,
              copyFallback,
              reasons: fallbackReasons
            }
          }
        ]
      : [])
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

function renderAiGenerationState(data) {
  const intentFallback = Boolean(data.parsed?.model_fallback);
  const blueprintFallback = Boolean(data.designBlueprint?.modelFallback);
  const copyFallback = Boolean(data.copyDraft?.modelFallback);
  const fallback = intentFallback || blueprintFallback || copyFallback;
  if (!fallback) return '<span class="badge ok">已使用大模型</span>';
  return '<span class="badge warn">部分降级到规则模板</span>';
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

function syncStartBuildAvailability() {
  const hasDemand = Boolean(String(demandInput.value || "").trim());
  startBuildButton.disabled = !hasDemand;
  if (!startBuildButton.disabled) {
    startBuildButton.textContent = "自动搭建并发布";
  }
}

function createDraftFallbackFromForm() {
  return {
    parsed: {
      page_goal: goalInput.value || "卖货转化",
      raw_demand: String(demandInput.value || "").trim()
    },
    execution: {
      page_name: `AI-${new Date().toISOString().slice(0, 10)}`,
      runtimeSelectors: {
        listPage: {
          pageUrl: "https://smp.iyouke.com/dtmall/designPage"
        }
      },
      actionTemplate: []
    },
    componentPlan: [],
    generatedAssets: []
  };
}

function createBuildRun(data, runId = null) {
  const components = Array.isArray(data.componentPlan) ? data.componentPlan.map((item) => item.displayName) : [];
  const pageName = data.execution?.page_name || data.designBlueprint?.page_name || `AI-${Date.now()}`;
  const pageGoal = data.parsed?.page_goal || "未知目标";
  const backendUrl = data.execution?.runtimeSelectors?.listPage?.pageUrl || "https://smp.iyouke.com/dtmall/designPage";
  const actionTemplate = data.execution?.actionTemplate || [];

  return {
    runId: runId || `build_${Date.now()}`,
    startedAt: new Date().toLocaleString("zh-CN"),
    pageName,
    pageGoal,
    backendUrl,
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
    actionTemplate
  };
}

function normalizeDraftFromAutoBuild(result) {
  if (result?.design_draft && typeof result.design_draft === "object") {
    return result.design_draft;
  }

  const design = result?.design;
  if (!design || typeof design !== "object") return null;

  return {
    design_id: result.design_id,
    parsed: result.parsed || null,
    template: design.template || { name: "AI 设计稿" },
    pageStructure: design.pageStructure || [],
    componentPlan: design.componentPlan || [],
    validation: {
      level: "warn",
      missing_components: [],
      unresolved_modules: [],
      limit_warnings: [],
      suggestions: ["建议查看组件映射后再发布"]
    },
    diff: {
      completed: [],
      replaced: [],
      unimplemented: [],
      editable_tips: []
    },
    execution: {
      page_name: `AI-${Date.now()}`,
      runtimeSelectors: {
        listPage: { pageUrl: "https://smp.iyouke.com/dtmall/designPage" }
      },
      actionTemplate: []
    },
    copyDraft: design.copyDraft || null,
    designBlueprint: design.designBlueprint || null,
    generatedAssets: result.assets || []
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
        syncStartBuildAvailability();
        startBuildButton.textContent = "自动搭建并发布";
      }
    } catch {
      window.clearInterval(buildPollTimer);
      buildPollTimer = null;
      syncStartBuildAvailability();
      startBuildButton.textContent = "自动搭建并发布";
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
