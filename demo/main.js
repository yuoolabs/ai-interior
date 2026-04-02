import { buildDraft, parseInput } from "./core/planner.js";
import { buildExecutionPlan } from "./core/executor.js";
import { explainDiff, validateResult } from "./core/validator.js";
import { analyzeReferenceImage } from "./core/reference-analyzer.js";

const form = document.getElementById("briefForm");
const demandInput = document.getElementById("demand");
const industryInput = document.getElementById("industry");
const goalInput = document.getElementById("goal");
const styleInput = document.getElementById("style");
const referenceInput = document.getElementById("reference");
const referencePanel = document.getElementById("referencePanel");
const referencePreview = document.getElementById("referencePreview");
const referenceSummary = document.getElementById("referenceSummary");

const resultPanel = document.getElementById("resultPanel");
const details = document.getElementById("details");
const jsonPanel = document.getElementById("jsonPanel");
const taskPanel = document.getElementById("taskPanel");
const runtimePanel = document.getElementById("runtimePanel");
const bootstrapPanel = document.getElementById("bootstrapPanel");
const savePanel = document.getElementById("savePanel");
const buildPanel = document.getElementById("buildPanel");

const summary = document.getElementById("summary");
const startBuildButton = document.getElementById("startBuildButton");
const structureList = document.getElementById("structureList");
const mappingList = document.getElementById("mappingList");
const executionList = document.getElementById("executionList");
const validation = document.getElementById("validation");
const taskList = document.getElementById("taskList");
const mcpOutput = document.getElementById("mcpOutput");
const selectorOutput = document.getElementById("selectorOutput");
const actionOutput = document.getElementById("actionOutput");
const bootstrapOutput = document.getElementById("bootstrapOutput");
const saveOutput = document.getElementById("saveOutput");
const jsonOutput = document.getElementById("jsonOutput");
const buildStatus = document.getElementById("buildStatus");
const buildMeta = document.getElementById("buildMeta");
const buildSteps = document.getElementById("buildSteps");
const buildPayload = document.getElementById("buildPayload");
let latestReferenceAnalysis = null;
let latestDraftData = null;
let currentBuildJobId = null;
let buildPollTimer = null;

referenceInput.addEventListener("change", async () => {
  latestReferenceAnalysis = await analyzeReferenceImage(referenceInput.files[0]);
  renderReference(latestReferenceAnalysis);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const referenceAnalysis = latestReferenceAnalysis || await analyzeReferenceImage(referenceInput.files[0]);

  const parsed = parseInput({
    demand: demandInput.value,
    industry: industryInput.value,
    goal: goalInput.value,
    style: styleInput.value,
    referenceFile: referenceInput.files[0],
    referenceAnalysis
  });

  const draft = buildDraft(parsed);
  const execution = buildExecutionPlan(draft.componentPlan, parsed);
  const validationResult = validateResult({
    pageStructure: draft.pageStructure,
    componentPlan: draft.componentPlan,
    parsed
  });
  const diff = explainDiff(draft.componentPlan);

  latestDraftData = {
    ...draft,
    execution,
    validation: validationResult,
    diff
  };

  render(latestDraftData);
});

startBuildButton.addEventListener("click", async () => {
  if (!latestDraftData) return;

  const buildRun = createBuildRun(latestDraftData);
  persistBuildRun(buildRun);
  startBuildButton.disabled = true;

  try {
    const response = await fetch("/api/build/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildRun)
    });

    if (!response.ok) {
      throw new Error("启动失败");
    }

    const result = await response.json();
    currentBuildJobId = result.jobId;
    renderBuildRun(buildRun, {
      state: "running",
      message: "已开始自动搭建，正在后台执行",
      logs: result.logs || [],
      currentStep: result.currentStep || "准备启动"
    });
    pollBuildStatus(buildRun);
  } catch (error) {
    renderBuildRun(buildRun, {
      state: "failed",
      message: "启动失败，请确认本地服务已启动后重试",
      logs: [error.message]
    });
    startBuildButton.disabled = false;
  }
});

function render(data) {
  resultPanel.hidden = false;
  details.hidden = false;
  jsonPanel.hidden = false;
  taskPanel.hidden = false;
  runtimePanel.hidden = false;
  bootstrapPanel.hidden = false;
  savePanel.hidden = false;
  buildPanel.hidden = true;
  startBuildButton.disabled = false;

  summary.innerHTML = [
    `<div><strong>页面目标：</strong>${data.parsed.page_goal}</div>`,
    `<div><strong>行业：</strong>${data.parsed.industry}</div>`,
    `<div><strong>风格：</strong>${data.parsed.style}</div>`,
    `<div><strong>模板：</strong>${data.template.name}</div>`,
    `<div><strong>参考图：</strong>${data.parsed.reference_image || "未上传"}</div>`,
    `<div><strong>校验结果：</strong>${renderBadge(data.validation.level)}</div>`
  ].join("");

  renderReference(data.parsed.reference_analysis);

  structureList.innerHTML = data.pageStructure
    .map((item, index) => `<li><strong>${index + 1}. ${item.type}</strong>：${item.purpose}</li>`)
    .join("");

  mappingList.innerHTML = data.componentPlan
    .map(
      (item) =>
        `<li><strong>${item.module}</strong> → ${item.displayName}（组件 key: ${item.component}；${item.reason}）</li>`
    )
    .join("");

  executionList.innerHTML = data.execution.steps.map((item) => `<li>${item}</li>`).join("");

  validation.innerHTML = [
    `<p><strong>已完成：</strong>${data.diff.completed.join("、") || "无"}</p>`,
    `<p><strong>替代实现：</strong>${data.diff.replaced.join("、") || "无"}</p>`,
    `<p><strong>未实现：</strong>${data.diff.unimplemented.join("、") || "无"}</p>`,
    `<p><strong>限制提醒：</strong>${data.validation.limit_warnings.join("；") || "无"}</p>`,
    `<p><strong>建议：</strong>${data.validation.suggestions.join("；")}</p>`
  ].join("");

  taskList.innerHTML = buildTaskItems(data.parsed.page_goal)
    .map((item) => `<li>${item}</li>`)
    .join("");

  mcpOutput.textContent = data.execution.mcpScript.join("\n");
  selectorOutput.textContent = JSON.stringify(data.execution.runtimeSelectors, null, 2);
  actionOutput.textContent = JSON.stringify(data.execution.actionTemplate, null, 2);
  bootstrapOutput.textContent = JSON.stringify(data.execution.bootstrapRun, null, 2);
  saveOutput.textContent = JSON.stringify(data.execution.saveChecklist, null, 2);
  jsonOutput.textContent = JSON.stringify(data, null, 2);
}

function renderReference(referenceAnalysis) {
  if (!referenceAnalysis) {
    referencePanel.hidden = true;
    referencePreview.removeAttribute("src");
    referenceSummary.innerHTML = "";
    return;
  }

  referencePanel.hidden = false;
  referencePreview.src = referenceAnalysis.previewUrl;

  referenceSummary.innerHTML = [
    `<div><strong>画面方向：</strong>${referenceAnalysis.orientation}</div>`,
    `<div><strong>主配色：</strong>${referenceAnalysis.hints.paletteSummary}</div>`,
    `<div><strong>页面风格判断：</strong>${referenceAnalysis.hints.style}</div>`,
    `<div><strong>建议页面目标：</strong>${referenceAnalysis.hints.suggestedGoal}</div>`,
    `<div><strong>建议模块：</strong>${referenceAnalysis.hints.modules.join("、")}</div>`,
    `<div><strong>区块位置判断：</strong>${referenceAnalysis.hints.zoneSummary.join(" → ")}</div>`,
    `<div><strong>判断依据：</strong>${referenceAnalysis.hints.reasons.join("；")}</div>`
  ].join("");
}

function renderBadge(level) {
  if (level === "ok") return '<span class="badge ok">通过</span>';
  if (level === "warn") return '<span class="badge warn">通过（有替代）</span>';
  return '<span class="badge bad">未通过</span>';
}

function buildTaskItems(goal) {
  const base = [
    "任务 1：需求解析，输出标准页面方案",
    "任务 2：按真实组件规则做映射",
    "任务 3：生成 Chrome DevTools MCP 执行清单",
    "任务 4：执行完成后校验保存、预览、替代项"
  ];

  if (goal === "卖货转化") {
    base.push("专项：补商品、优惠券、倒计时的默认填充策略");
  } else if (goal === "会员拉新") {
    base.push("专项：优先走办理会员，失败时自动降级为涨粉或文本引导");
  } else {
    base.push("专项：优先走预约事件，失败时降级为富文本 + 导航入口");
  }

  return base;
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
    steps: [
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
      const response = await fetch(`/api/build/status?id=${encodeURIComponent(currentBuildJobId)}`);
      if (!response.ok) {
        throw new Error("状态查询失败");
      }

      const status = await response.json();
      renderBuildRun(buildRun, status);

      if (status.state === "done" || status.state === "failed") {
        window.clearInterval(buildPollTimer);
        buildPollTimer = null;
        startBuildButton.disabled = false;
      }
    } catch {
      window.clearInterval(buildPollTimer);
      buildPollTimer = null;
      startBuildButton.disabled = false;
      renderBuildRun(buildRun, {
        state: "failed",
        message: "状态查询失败，请稍后重试",
        logs: ["页面无法拿到后台执行状态"]
      });
    }
  }, 1200);
}

function renderBuildRun(buildRun, status) {
  buildPanel.hidden = false;

  const logItems = (status.logs || []).map((item) => `<li>${item}</li>`).join("");
  buildStatus.innerHTML = [
    `<div><strong>当前状态：</strong>${renderBuildState(status.state, status.message)}</div>`,
    `<div><strong>本次页面：</strong>${buildRun.pageName}</div>`,
    `<div><strong>当前动作：</strong>${status.currentStep || "等待开始"}</div>`,
    `<div><strong>说明：</strong>${status.message || "已创建搭建任务"}</div>`,
    logItems ? `<div><strong>执行记录：</strong><ol>${logItems}</ol></div>` : ""
  ].join("");

  buildMeta.innerHTML = [
    `<li><strong>任务编号：</strong>${buildRun.runId}</li>`,
    `<li><strong>开始时间：</strong>${buildRun.startedAt}</li>`,
    `<li><strong>页面目标：</strong>${buildRun.pageGoal}</li>`,
    `<li><strong>后台地址：</strong><a href="${buildRun.backendUrl}" target="_blank" rel="noreferrer">打开后台</a></li>`
  ].join("");

  buildSteps.innerHTML = buildRun.steps.map((item) => `<li>${item}</li>`).join("");
  buildPayload.textContent = JSON.stringify(buildRun, null, 2);
}

function renderBuildState(state, message) {
  if (state === "done") return `<span class="badge ok">${message || "已完成"}</span>`;
  if (state === "running") return `<span class="badge warn">${message || "执行中"}</span>`;
  if (state === "blocked") return `<span class="badge bad">${message || "需要先处理"}</span>`;
  if (state === "failed") return `<span class="badge bad">${message || "失败"}</span>`;
  return `<span class="badge warn">${message || "准备中"}</span>`;
}
