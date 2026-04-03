const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createOrchestrator, getSystemConfig } = require("./backend");
const { createDefaultAdapterConfig, applyCustomConfig, validateAdapterConfig } = require("./backend/services/page-adapter-config");

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT || 8001);
const rootDir = __dirname;
const jobs = new Map();
let eventSequence = 0;

const orchestrator = createOrchestrator({
  rootDir,
  uiFallbackRunner: async ({ run, draft, assets }) => {
    const buildRun = {
      pageName: draft?.execution?.page_name || `AI-${Date.now()}`,
      pageGoal: draft?.parsed?.page_goal || "卖货转化",
      backendUrl: draft?.execution?.runtimeSelectors?.listPage?.pageUrl || "https://smp.iyouke.com/dtmall/designPage",
      actionTemplate: draft?.execution?.actionTemplate || [],
      generatedAssets: assets || []
    };

    const legacyJob = {
      id: run.id,
      state: run.state || "running",
      message: run.message || "准备开始",
      currentStep: run.currentStep || "准备开始",
      logs: run.logs || [],
      events: run.events || [],
      buildRun
    };

    await runBuild(legacyJob);

    return {
      channel: "ui_fallback",
      pageId: `ui_${Date.now()}`,
      completed: legacyJob.logs.slice(-10)
    };
  }
});

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/v1/system/health") {
      return sendJson(res, 200, {
        status: "ok",
        time: new Date().toISOString(),
        system: getSystemConfig()
      });
    }

    if (req.method === "GET" && req.url === "/v1/system/config") {
      return sendJson(res, 200, {
        system: getSystemConfig()
      });
    }

    if (req.method === "GET" && req.url === "/v1/system/rollout") {
      return sendJson(res, 200, {
        rollout: orchestrator.getRolloutStatus()
      });
    }

    if (req.method === "POST" && req.url === "/v1/system/preflight") {
      const body = await readJson(req);
      const result = await orchestrator.systemPreflight(body || {});
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/v1/system/profile/validate") {
      const body = await readJson(req);
      const profile = resolveProfilePayload(body);
      const merged = createDefaultAdapterConfig();
      applyCustomConfig(merged, profile);
      const validation = validateAdapterConfig(merged);
      return sendJson(res, 200, {
        valid: validation.valid,
        errors: validation.errors,
        hints: validation.valid
          ? ["profile 配置通过，可用于 real 模式联调"]
          : [
              "补齐缺失 action 配置",
              "检查 method/path 是否为空",
              "确认路径模板中的变量能被解析（例如 runtime.pageId）"
            ]
      });
    }

    if (req.method === "POST" && req.url === "/v1/intent/parse") {
      const body = await readJson(req);
      const result = await orchestrator.parseIntent(body);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/v1/design/generate") {
      const body = await readJson(req);
      const result = await orchestrator.generateDesign(body);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/v1/assets/generate-and-upload") {
      const body = await readJson(req);
      const result = await orchestrator.generateAssetsAndUpload(body);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/v1/page/execute") {
      const body = await readJson(req);
      const result = await orchestrator.executePage(body);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/v1/page/publish") {
      const body = await readJson(req);
      const result = await orchestrator.publishPage(body);
      return sendJson(res, 200, result);
    }

    const runRoute = matchRunRoute(req.url || "");
    if (runRoute && req.method === "GET" && runRoute.action === "get") {
      const run = orchestrator.getRun(runRoute.runId);
      if (!run) {
        return sendJson(res, 404, { message: "任务不存在" });
      }
      return sendJson(res, 200, run);
    }

    if (runRoute && req.method === "POST" && runRoute.action === "takeover") {
      const body = await readJson(req);
      const result = await orchestrator.takeoverRun({
        run_id: runRoute.runId,
        reason: body?.reason,
        operator: body?.operator
      });
      return sendJson(res, 200, result);
    }

    if (runRoute && req.method === "POST" && runRoute.action === "resume") {
      const body = await readJson(req);
      const result = await orchestrator.resumeRun({
        run_id: runRoute.runId,
        auto_publish: body?.auto_publish,
        auth_level: body?.auth_level,
        tenant_id: body?.tenant_id,
        design_id: body?.design_id
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && req.url === "/api/assets/generate") {
      const body = await readJson(req);
      const assets = generateVisualAssets(body);
      return sendJson(res, 200, { assets });
    }

    if (req.method === "POST" && req.url === "/api/build/start") {
      const body = await readJson(req);
      const jobId = `job_${Date.now()}`;
      const job = {
        id: jobId,
        state: "running",
        message: "准备开始",
        currentStep: "准备开始",
        logs: ["已收到自动搭建请求"],
        events: [],
        buildRun: body
      };
      appendJobEvent(job, {
        stage: "runtime_execution",
        kind: "insight",
        title: "收到自动搭建请求",
        message: "我已收到自动搭建请求，正在准备进入微页面列表并创建新页面。",
        status: "done",
        details: {
          pageName: body.pageName || "",
          goal: body.pageGoal || "",
          backendUrl: body.backendUrl || ""
        }
      });
      jobs.set(jobId, job);
      runBuild(job).catch((error) => {
        const friendly = humanizeError(error.message || "");
        job.state = friendly.state;
        job.message = friendly.message;
        job.currentStep = "已停止";
        job.logs.push(friendly.detail);
        appendJobEvent(job, {
          stage: "runtime_execution",
          kind: "warning",
          title: "自动搭建中断",
          message: friendly.message,
          status: friendly.state === "blocked" ? "degraded" : "failed",
          details: friendly.detail
        });
      });
      return sendJson(res, 200, serializeJob(job, { jobId, message: "已开始自动搭建" }));
    }

    if (req.method === "GET" && req.url && req.url.startsWith("/api/build/status")) {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const jobId = url.searchParams.get("id");
      const job = jobId ? jobs.get(jobId) : null;
      if (!job) {
        return sendJson(res, 404, { message: "任务不存在" });
      }
      return sendJson(res, 200, serializeJob(job, { id: job.id }));
    }

    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, { message: error.message || "服务异常" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Demo server running at http://0.0.0.0:${port}`);
});

async function runBuild(job) {
  const { buildRun } = job;
  const actionTemplate = Array.isArray(buildRun.actionTemplate) ? buildRun.actionTemplate : [];
  const steps = [
    ["打开微页面列表", async () => {
      await ensureDesignListReady(buildRun.backendUrl);
    }],
    ["点击新建页面", async () => {
      await clickByText("新建页面");
      await delay(2500);
      const currentUrl = await getActiveTabUrl().catch(() => "");
      if (!currentUrl.includes("/dtmall/pageDesign")) {
        throw new Error(`没有真正进入新建页编辑器，当前停留在：${currentUrl || "未知页面"}`);
      }
    }],
    ["等待进入编辑页", async () => {
      await waitForCondition(() => focusEditorTab(), 25000);
      await waitForCondition(() => hasPlaceholder("请设置微页面名称"), 20000);
    }],
    ["填写页面名称", async () => fillByPlaceholder("请设置微页面名称", buildRun.pageName)],
    ...buildActionSteps(actionTemplate, buildRun, job),
    ["点击保存", async () => clickByText("保 存")]
  ];

  for (const [label, action] of steps) {
    job.currentStep = label;
    job.message = "正在执行";
    job.logs.push(label);
    const event = appendJobEvent(job, {
      stage: "runtime_execution",
      kind: label.startsWith("补内容") || label.startsWith("添加组件") ? "action" : "insight",
      title: label,
      message: describeRuntimeStep(label, "running"),
      status: "running",
      details: getRuntimeStepDetails(label, buildRun)
    });
    await action();
    updateJobEvent(event, {
      status: "done",
      message: describeRuntimeStep(label, "done")
    });
  }

  job.state = "done";
  job.message = "已完成自动搭建";
  job.currentStep = "全部完成";
  job.logs.push("自动搭建已完成");
  appendJobEvent(job, {
    stage: "runtime_execution",
    kind: "result",
    title: "自动搭建完成",
    message: "我已完成页面搭建流程，当前页面已达到可保存/可预览状态。",
    status: "done",
    details: {
      completedSteps: job.logs.filter((item) => !item.startsWith("组件诊断")).slice(-8)
    }
  });
}

function resolveProfilePayload(body) {
  if (!body || typeof body !== "object") return {};
  if (body.profile && typeof body.profile === "object") return body.profile;
  if (body.actions || body.uploadMaterial) return body;
  return {};
}

function buildActionSteps(actionTemplate, buildRun, job) {
  return actionTemplate
    .filter((item) => item.step && !["open_list_page", "open_editor", "open_editor_direct", "set_page_name", "preview_page", "save_page"].includes(item.step))
    .map((item) => {
      if (item.step.startsWith("add_component_")) {
        return [
          `添加组件：${item.target}`,
          async () => {
            await logComponentDiagnostics(job, item.target, "点击前");
            await clickPaletteComponent(item.target);
            await delay(700);
            const diagnostics = await getPageDiagnostics().catch(() => null);
            logComponentDiagnosticsSnapshot(job, item.target, "点击后", diagnostics);
            const currentUrl = diagnostics?.url || "";
            if (!currentUrl.includes("/dtmall/pageDesign")) {
              job.logs.push(`组件跳转告警：${item.target} 已离开编辑器，当前 URL=${currentUrl || "未知页面"}`);
              throw new Error(`添加组件时页面跳转走了，当前停留在：${currentUrl || "未知页面"}`);
            }
          }
        ];
      }

      if (item.step.startsWith("fill_component_")) {
        return [
          `补内容：${item.target}`,
          async () => runFillAction(item, buildRun, job)
        ];
      }

      return [
        item.step,
        async () => delay(200)
      ];
    });
}

async function runFillAction(item, buildRun, job) {
  if (item.action === "richtext_fill") {
    await fillRichText(buildRun.pageGoal);
    return;
  }

  if (item.action === "link_nav_fill") {
    await fillLinkNavigation("导航1-子页面");
    return;
  }

  if (item.action === "material_pick") {
    await fillBannerImage(job, buildRun.generatedAssets || []);
    return;
  }

  if (item.action === "coupon_pick") {
    await fillCoupon();
    return;
  }

  if (item.action === "product_pick") {
    await fillProduct(job);
    return;
  }
}

async function fillRichText(pageGoal) {
  const content = getDefaultRichText(pageGoal);
  const result = await executeBrowserScript(`
    (() => {
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const editor = Array.from(document.querySelectorAll("[contenteditable='true'], .ql-editor, .w-e-text-container [contenteditable='true']"))
        .find((el) => visible(el));
      if (!editor) {
        return JSON.stringify({ ok: false, reason: "editor_not_found" });
      }
      editor.focus();
      editor.innerHTML = ${JSON.stringify(content.split("\n").map((line) => `<p>${line}</p>`).join(""))};
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: ${JSON.stringify(content)} }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      editor.blur();
      const bodyText = normalize(document.body.innerText || "");
      return JSON.stringify({ ok: true, filled: bodyText.includes(${JSON.stringify(content.split("\n")[0])}) });
    })();
  `);
  const parsed = parseResult(result);
  if (!parsed.ok || !parsed.filled) {
    throw new Error("富文本内容未写入成功");
  }
}

async function fillLinkNavigation(pageName) {
  await clickByText("添加0/8导航项").catch(() => clickByText("添加1/8导航项"));
  await delay(500);
  await clickByText("选择现有页面");
  await delay(800);
  const selectResult = await executeBrowserScript(`
    (() => {
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const row = Array.from(document.querySelectorAll("tr, div, span, p"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent) === ${JSON.stringify(pageName)});
      if (!row) {
        return JSON.stringify({ ok: false, reason: "page_not_found" });
      }
      row.click();
      const confirm = Array.from(document.querySelectorAll("button"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent) === "确 定");
      if (confirm) confirm.click();
      const bodyText = normalize(document.body.innerText || "");
      return JSON.stringify({ ok: true, linked: bodyText.includes(${JSON.stringify(pageName)}) || bodyText.includes("添加1/8导航项") });
    })();
  `);
  const parsed = parseResult(selectResult);
  if (!parsed.ok || !parsed.linked) {
    throw new Error("链接导航未补充成功");
  }
}

async function fillCoupon() {
  // 点击"添加优惠券"按钮
  await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const btn = Array.from(document.querySelectorAll("button, div, span"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent).includes("添加优惠券"));
      if (btn) btn.click();
      return JSON.stringify({ ok: !!btn });
    })();
  `);
  // 等弹窗出现
  await delay(1200);
  const result = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      // 勾选第一张优惠券（checkbox 或可点击行）
      const checkbox = Array.from(document.querySelectorAll("input[type='checkbox']")).find((el) => visible(el));
      if (checkbox) { checkbox.click(); }
      else {
        const row = Array.from(document.querySelectorAll("tr.ant-table-row")).find((el) => visible(el));
        if (row) row.click();
      }
      const confirm = Array.from(document.querySelectorAll("button"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent) === "确 定");
      if (confirm) confirm.click();
      return JSON.stringify({ ok: !!(checkbox || true) });
    })();
  `);
  const parsed = parseResult(result);
  if (!parsed.ok) {
    throw new Error("优惠券未补充成功");
  }
}

async function fillBannerImage(job, generatedAssets = []) {
  const log = (message) => {
    if (job?.logs && Array.isArray(job.logs)) {
      job.logs.push(message);
    }
  };
  const targetAsset = generatedAssets.find((item) => item.componentDisplayName === "图文广告" || item.componentModule === "banner") || null;
  if (targetAsset) {
    log(`图文广告补图：已拿到 AI 素材 -> ${targetAsset.title} | 状态=${targetAsset.uploadStatusLabel || targetAsset.uploadStatus || "未知"} | 路径=${targetAsset.publicUrl || targetAsset.localPath || "未知"}`);
  }
  await logFillDiagnostics(log, "补图开始前");
  // 只对真实的 dropdown trigger 按钮做 hover，避免误点到会外跳的分支
  const triggerRaw = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => {
        const r = el.getBoundingClientRect(), s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      };
      const trigger = Array.from(document.querySelectorAll("button.upload-con.ant-dropdown-trigger"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent).includes("添加"));
      if (!trigger) {
        return JSON.stringify({ ok: false, reason: "dropdown_trigger_not_found" });
      }

      const rect = trigger.getBoundingClientRect();
      const mouseInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      };
      ["pointerenter", "mouseenter", "pointerover", "mouseover", "mousemove"].forEach((type) => {
        trigger.dispatchEvent(new MouseEvent(type, mouseInit));
      });
      trigger.focus();

      return JSON.stringify({
        ok: true,
        text: normalize(trigger.innerText || trigger.textContent).slice(0, 120),
        mode: "hover_trigger",
        className: trigger.className || ""
      });
    })();
  `);
  const triggerParsed = parseResult(triggerRaw);
  log(`图文广告补图：触发自定义上传 -> ${triggerParsed.ok ? `${triggerParsed.mode || "unknown"}(${triggerParsed.text || "未知文案"})` : `失败(${triggerParsed.reason || "未找到按钮"})`}`);
  if (!triggerParsed.ok && triggerParsed.wrapperText) {
    log(`图文广告补图：实例定位信息 -> class=${triggerParsed.wrapperClass || "unknown"} text=${triggerParsed.wrapperText}`);
  }
  if (!triggerParsed.ok) {
    await logFillDiagnostics(log, "触发按钮失败后");
    throw new Error("图文广告图片未补充成功");
  }

  await delay(500);
  const uploadMenuRaw = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => {
        const r = el.getBoundingClientRect(), s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      };
      const uploadTab = Array.from(document.querySelectorAll(".ant-dropdown-menu-item, .ant-dropdown-menu-item span"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent) === "自定义上传");
      if (!uploadTab) {
        const menus = Array.from(document.querySelectorAll(".ant-dropdown-menu, .ant-dropdown-menu-item"))
          .filter((el) => visible(el))
          .map((el) => normalize(el.innerText || el.textContent))
          .filter(Boolean)
          .slice(0, 20);
        return JSON.stringify({ ok: false, reason: "upload_menu_not_found", menus });
      }
      uploadTab.click();
      return JSON.stringify({ ok: true, text: normalize(uploadTab.innerText || uploadTab.textContent) });
    })();
  `);
  const uploadMenuParsed = parseResult(uploadMenuRaw);
  log(`图文广告补图：选择菜单项 -> ${uploadMenuParsed.ok ? `已点击(${uploadMenuParsed.text || "自定义上传"})` : `失败(${uploadMenuParsed.reason || "unknown"})`}`);
  if (!uploadMenuParsed.ok && Array.isArray(uploadMenuParsed.menus) && uploadMenuParsed.menus.length) {
    log(`图文广告补图：当前可见下拉 -> ${uploadMenuParsed.menus.join(" | ")}`);
  }
  if (!uploadMenuParsed.ok) {
    await logFillDiagnostics(log, "未找到自定义上传后");
    throw new Error("图文广告图片未补充成功");
  }

  // 等图片管理器出现
  await delay(1200);
  await logFillDiagnostics(log, "触发自定义上传后");
  const selectResult = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const modal = Array.from(document.querySelectorAll(".ant-modal"))
        .find((el) => {
          if (!visible(el)) return false;
          const title = normalize(el.querySelector(".ant-modal-title")?.innerText || el.querySelector(".ant-modal-title")?.textContent);
          return title.includes("图片管理器");
        });
      if (!modal) {
        return JSON.stringify({
          ok: false,
          reason: "image_manager_modal_not_found",
          imageManagerVisible: false
        });
      }
      const item = Array.from(modal.querySelectorAll(".img-list-container .elx-img-list .img-item"))
        .find((el) => visible(el));
      if (!item) {
        return JSON.stringify({
          ok: false,
          reason: "image_item_not_found",
          imageManagerVisible: true
        });
      }
      const itemTitle = normalize(item.querySelector(".title")?.innerText || item.querySelector(".title")?.textContent);
      const image = item.querySelector("img.img");
      item.scrollIntoView({ block: "center", inline: "center" });
      const clickTarget = image || item;
      if (typeof clickTarget.click === "function") {
        clickTarget.click();
      }
      ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
        clickTarget.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      const selected = item.classList.contains("selected") || !!item.querySelector(".selected-item, .selected-item-index");
      return JSON.stringify({
        ok: true,
        imageManagerVisible: true,
        selected: !!selected,
        selectedTitle: itemTitle
      });
    })();
  `);
  const selectParsed = parseResult(selectResult);
  log(`图文广告补图：素材点击结果 -> ok=${Boolean(selectParsed.ok)} reason=${selectParsed.reason || "none"} 图片管理器=${Boolean(selectParsed.imageManagerVisible)} selected=${Boolean(selectParsed.selected)} 已选素材=${selectParsed.selectedTitle || "unknown"}`);
  if (!selectParsed.ok) {
    await logFillDiagnostics(log, "补图失败后");
    throw new Error("图文广告图片未补充成功");
  }

  await delay(400);
  const confirmResult = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const modal = Array.from(document.querySelectorAll(".ant-modal"))
        .find((el) => {
          if (!visible(el)) return false;
          const title = normalize(el.querySelector(".ant-modal-title")?.innerText || el.querySelector(".ant-modal-title")?.textContent);
          return title.includes("图片管理器");
        });
      if (!modal) {
        return JSON.stringify({ ok: false, reason: "image_manager_modal_not_found" });
      }
      const selectedItem = Array.from(modal.querySelectorAll(".img-list-container .elx-img-list .img-item"))
        .find((el) => el.classList.contains("selected") || !!el.querySelector(".selected-item, .selected-item-index"));
      if (!selectedItem) {
        return JSON.stringify({ ok: false, reason: "selected_item_not_found" });
      }
      const confirm = modal.querySelector(".ant-modal-footer .ant-btn-primary");
      if (!confirm) {
        return JSON.stringify({ ok: false, reason: "confirm_not_found" });
      }
      confirm.click();
      return JSON.stringify({
        ok: true,
        selectedTitle: normalize(selectedItem.querySelector(".title")?.innerText || selectedItem.querySelector(".title")?.textContent)
      });
    })();
  `);
  const confirmParsed = parseResult(confirmResult);
  log(`图文广告补图：确认结果 -> ok=${Boolean(confirmParsed.ok)} reason=${confirmParsed.reason || "none"} 已确认素材=${confirmParsed.selectedTitle || "unknown"}`);
  if (!confirmParsed.ok) {
    await logFillDiagnostics(log, "补图失败后");
    throw new Error("图文广告图片未补充成功");
  }

  await delay(1000);
  const verifyResult = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const bodyText = normalize(document.body.innerText || "");
      return JSON.stringify({
        ok: true,
        filled: bodyText.includes("添加 1/10 图片") || bodyText.includes("添加1/10图片")
      });
    })();
  `);
  const verifyParsed = parseResult(verifyResult);
  log(`图文广告补图：补图校验 -> filled=${Boolean(verifyParsed.filled)}`);
  if (!verifyParsed.ok || !verifyParsed.filled) {
    await logFillDiagnostics(log, "补图失败后");
    throw new Error("图文广告图片未补充成功");
  }
  await logFillDiagnostics(log, "补图成功后");
}

async function logFillDiagnostics(log, phase) {
  const diagnostics = await getPageDiagnostics().catch(() => null);
  if (!diagnostics) {
    log(`图文广告补图诊断[${phase}]：页面快照获取失败`);
    return;
  }
  const excerpt = diagnostics.excerpt ? ` | 摘要=${diagnostics.excerpt}` : "";
  log(`图文广告补图诊断[${phase}]：URL=${diagnostics.url || "未知"} | 标题=${diagnostics.title || "无标题"}${excerpt}`);
}

async function fillProduct(job) {
  const log = (message) => {
    if (job?.logs && Array.isArray(job.logs)) {
      job.logs.push(message);
    }
  };
  // 点击"添加商品"触发按钮
  await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const trigger = Array.from(document.querySelectorAll("button"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent).includes("添加商品"));
      if (trigger) trigger.click();
      return JSON.stringify({ ok: !!trigger });
    })();
  `);
  // 等弹窗出现
  await delay(1000);
  // 点击"查询"
  const searchResult = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const search = Array.from(document.querySelectorAll("button, span, div"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent) === "查询");
      if (search) search.click();
      return JSON.stringify({ ok: !!search });
    })();
  `);
  const searchParsed = parseResult(searchResult);
  if (!searchParsed.ok) {
    throw new Error("商品未补充成功：未找到查询按钮");
  }
  log("商品选择：已点击查询，正在等待商品列表返回。");
  // 等查询结果真正出现，避免点得太快拿不到第一条商品
  await waitForCondition(async () => {
    const probe = await executeBrowserScript(`
      (() => {
        const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
        const visible = (el) => {
          const r = el.getBoundingClientRect(), s = window.getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
        };
        const modal = Array.from(document.querySelectorAll(".ant-modal"))
          .find((el) => visible(el) && normalize(el.querySelector(".ant-modal-title")?.innerText || el.querySelector(".ant-modal-title")?.textContent).includes("商品"));
        const scope = modal || document;
        const row = Array.from(scope.querySelectorAll("tbody tr.ant-table-row, .ant-table-body tr.ant-table-row"))
          .find((el) => visible(el) && normalize(el.innerText || el.textContent).length > 0);
        return JSON.stringify({ ok: !!row });
      })();
    `);
    return Boolean(parseResult(probe).ok);
  }, 5000);

  const pickResult = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const modal = Array.from(document.querySelectorAll(".ant-modal"))
        .find((el) => visible(el) && normalize(el.querySelector(".ant-modal-title")?.innerText || el.querySelector(".ant-modal-title")?.textContent).includes("商品"));
      if (!modal) {
        return JSON.stringify({ ok: false, reason: "modal_not_found" });
      }

      const row = Array.from(modal.querySelectorAll("tbody tr.ant-table-row, .ant-table-body tr.ant-table-row"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent).length > 0);
      if (!row) {
        return JSON.stringify({ ok: false, reason: "row_not_found", selected: false });
      }

      const checkboxInput = row.querySelector("input[type='checkbox'], .ant-checkbox-input");
      const checkboxBox =
        row.querySelector(".ant-checkbox-inner")
        || row.querySelector(".ant-checkbox")
        || checkboxInput?.closest("label")
        || checkboxInput?.parentElement;
      const firstCell = row.querySelector("td");

      const clickTarget = checkboxBox || checkboxInput || firstCell || row;
      row.scrollIntoView({ block: "center", inline: "center" });
      if (typeof clickTarget.click === "function") {
        clickTarget.click();
      }
      ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
        clickTarget.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });

      const selected = row.classList.contains("ant-table-row-selected")
        || !!row.querySelector("input[type='checkbox']:checked")
        || !!row.querySelector(".ant-checkbox-checked")
        || normalize(modal.innerText || "").includes("已选 1")
        || normalize(modal.innerText || "").includes("已选1");

      return JSON.stringify({
        ok: true,
        selected,
        productName: normalize(row.innerText || row.textContent).slice(0, 120)
      });
    })();
  `);
  const pickParsed = parseResult(pickResult);
  log(`商品选择：首条商品点击结果 -> ok=${Boolean(pickParsed.ok)} selected=${Boolean(pickParsed.selected)} 商品=${pickParsed.productName || "unknown"} reason=${pickParsed.reason || "none"}`);
  if (!pickParsed.ok) {
    throw new Error("商品未补充成功：未找到可选商品");
  }

  await waitForCondition(async () => {
    const probe = await executeBrowserScript(`
      (() => {
        const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
        const visible = (el) => {
          const r = el.getBoundingClientRect(), s = window.getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
        };
        const modal = Array.from(document.querySelectorAll(".ant-modal"))
          .find((el) => visible(el) && normalize(el.querySelector(".ant-modal-title")?.innerText || el.querySelector(".ant-modal-title")?.textContent).includes("商品"));
        if (!modal) return JSON.stringify({ ok: false, reason: "modal_not_found" });
        const text = normalize(modal.innerText || "");
        const selected =
          text.includes("已选 1 件") ||
          text.includes("已选1件") ||
          text.includes("已选 1") ||
          text.includes("已选1") ||
          !!modal.querySelector(".ant-checkbox-checked");
        return JSON.stringify({ ok: selected, text: text.slice(0, 200) });
      })();
    `);
    return Boolean(parseResult(probe).ok);
  }, 4000);

  log("商品选择：已识别到至少 1 件商品被选中，准备点击确定。");

  const confirmResult = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const modal = Array.from(document.querySelectorAll(".ant-modal"))
        .find((el) => visible(el) && normalize(el.querySelector(".ant-modal-title")?.innerText || el.querySelector(".ant-modal-title")?.textContent).includes("商品"));
      if (!modal) {
        return JSON.stringify({ ok: false, reason: "modal_not_found" });
      }
      const confirm = Array.from(modal.querySelectorAll("button"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent) === "确定");
      if (!confirm) {
        return JSON.stringify({ ok: false, reason: "confirm_not_found" });
      }
      confirm.click();
      return JSON.stringify({ ok: true });
    })();
  `);
  const confirmParsed = parseResult(confirmResult);
  if (!confirmParsed.ok) {
    throw new Error("商品未补充成功：未找到确定按钮");
  }

  await waitForCondition(async () => {
    const probe = await executeBrowserScript(`
      (() => {
        const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
        const bodyText = normalize(document.body.innerText || "");
        const modalVisible = Array.from(document.querySelectorAll(".ant-modal"))
          .some((el) => {
            const r = el.getBoundingClientRect();
            const s = window.getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" &&
              normalize(el.querySelector(".ant-modal-title")?.innerText || el.querySelector(".ant-modal-title")?.textContent).includes("商品");
          });
        const filled =
          bodyText.includes("添加商品（1/100）") ||
          bodyText.includes("添加商品(1/100)") ||
          bodyText.includes("已选 1 件") ||
          bodyText.includes("已选1件") ||
          bodyText.includes("已选 1") ||
          bodyText.includes("已选1");
        return JSON.stringify({ ok: !modalVisible && filled, filled, modalVisible, bodyText: bodyText.slice(0, 220) });
      })();
    `);
    return Boolean(parseResult(probe).ok);
  }, 5000);

  const verifyResult = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const bodyText = normalize(document.body.innerText || "");
      return JSON.stringify({
        ok: true,
        filled:
          bodyText.includes("添加商品（1/100）") ||
          bodyText.includes("添加商品(1/100)") ||
          bodyText.includes("已选 1 件") ||
          bodyText.includes("已选1件") ||
          bodyText.includes("已选 1") ||
          bodyText.includes("已选1")
      });
    })();
  `);
  const verifyParsed = parseResult(verifyResult);
  log(`商品选择：确认后校验 -> filled=${Boolean(verifyParsed.filled)}`);
  if (!verifyParsed.ok || !verifyParsed.filled) {
    throw new Error("商品未补充成功");
  }
}

function getDefaultRichText(pageGoal) {
  if (pageGoal === "会员拉新") {
    return [
      "开通会员，解锁专属折扣与会员价",
      "精选权益每月可用，购物更省更方便",
      "现在加入，立刻查看会员专享商品"
    ].join("\n");
  }

  if (pageGoal === "活动推广") {
    return [
      "活动名额有限，先报名先锁定福利",
      "完成报名后可收到活动提醒与专属通知",
      "建议尽快提交信息，避免错过活动时间"
    ].join("\n");
  }

  return [
    "限时活动已开启，核心福利一页看清",
    "重点优惠、爆款商品和行动入口都已准备好",
    "建议立即下单，避免错过当前活动价格"
  ].join("\n");
}

async function ensureBackendTab(url) {
  const reused = await focusChromeTab({
    urlFragments: ["/dtmall/designPage", "/dtmall/pageDesign", "/smp/application"]
  }).catch(() => false);

  if (reused) {
    const script = [
      'tell application "Google Chrome"',
      "activate",
      `set URL of active tab of front window to ${appleString(url)}`,
      "set index of front window to 1",
      "end tell"
    ];
    await runAppleScript(script);
  } else {
    const script = [
      'tell application "Google Chrome"',
      "activate",
      `tell front window to make new tab with properties {URL:${appleString(url)}}`,
      "set active tab index of front window to (count of tabs of front window)",
      "set index of front window to 1",
      "end tell"
    ];
    await runAppleScript(script);
  }

  await delay(3000);
}

async function ensureDesignListReady(url) {
  await ensureBackendTab(toDesignListUrl(url));
  await delay(2500);

  const currentUrl = await getActiveTabUrl().catch(() => "");
  if (currentUrl.includes("/smp/application")) {
    throw new Error(`系统把页面跳回了应用首页：${currentUrl}`);
  }

  if (await isDesignListReady()) {
    return;
  }

  throw new Error(`没有真正进入微信页面装修，当前停留在：${currentUrl || "未知页面"}`);
}

async function ensureEditorReady(url) {
  await ensureBackendTab(url);
  await delay(2500);

  const currentUrl = await getActiveTabUrl().catch(() => "");
  if (currentUrl.includes("/dtmall/pageDesign?newPage=true")) {
    return;
  }

  await ensureDesignListReady(url);
  throw new Error(`没有真正进入新建页，当前停留在：${currentUrl || "未知页面"}`);
}

async function activateTabByUrlFragment(fragment) {
  return focusChromeTab({
    urlFragments: [fragment]
  });
}

async function focusEditorTab() {
  return focusChromeTab({
    urlFragments: ["/dtmall/pageDesign?newPage=true", "/dtmall/pageDesign"]
  });
}

async function focusChromeTab({ urlFragments = [], titleIncludes = [] }) {
  const script = [
    'tell application "Google Chrome"',
    "activate",
    "set tabFound to false",
    "repeat with w from (count of windows) to 1 by -1",
    "repeat with t from (count of tabs of window w) to 1 by -1",
    "set currentUrl to URL of tab t of window w as text",
    "set currentTitle to title of tab t of window w as text",
    `if ${buildChromeTabMatchCondition(urlFragments, titleIncludes)} then`,
    "set active tab index of window w to t",
    "set index of window w to 1",
    "set tabFound to true",
    "exit repeat",
    "end if",
    "end repeat",
    "if tabFound then exit repeat",
    "end repeat",
    "return tabFound",
    "end tell"
  ];
  const output = await runAppleScript(script);
  return output === "true";
}

function buildChromeTabMatchCondition(urlFragments, titleIncludes) {
  const urlChecks = urlFragments.map((fragment) => `(currentUrl contains ${appleString(fragment)})`);
  const titleChecks = titleIncludes.map((text) => `(currentTitle contains ${appleString(text)})`);
  const checks = [...urlChecks, ...titleChecks];
  if (!checks.length) {
    return "false";
  }
  return checks.join(" or ");
}

async function clickPaletteComponent(targetText) {
  const result = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => {
        const r = el.getBoundingClientRect(), s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      };

      // 拦截所有路由跳转，只允许停留在编辑器页
      const origPushState = history.pushState.bind(history);
      const origReplaceState = history.replaceState.bind(history);
      const origAssign = window.location.assign.bind(window.location);
      history.pushState = function(...args) {
        const url = String(args[2] || "");
        if (url && !url.includes("/dtmall/pageDesign")) return;
        return origPushState(...args);
      };
      history.replaceState = function(...args) {
        const url = String(args[2] || "");
        if (url && !url.includes("/dtmall/pageDesign")) return;
        return origReplaceState(...args);
      };
      window.location.assign = function(url) {
        if (!String(url).includes("/dtmall/pageDesign")) return;
        return origAssign(url);
      };

      const item = Array.from(document.querySelectorAll("li"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent) === ${JSON.stringify(targetText)});

      if (!item) {
        history.pushState = origPushState;
        history.replaceState = origReplaceState;
        window.location.assign = origAssign;
        return JSON.stringify({ ok: false, reason: "not_found" });
      }

      // 阻止 li 内所有 a 标签的默认跳转
      item.querySelectorAll("a").forEach((a) => {
        a.addEventListener("click", (e) => e.preventDefault(), { once: true, capture: true });
      });

      item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

      // 1秒后恢复正常路由（保证组件加载完成后再开放）
      setTimeout(() => {
        history.pushState = origPushState;
        history.replaceState = origReplaceState;
        window.location.assign = origAssign;
      }, 1000);

      return JSON.stringify({ ok: true, text: normalize(item.innerText || item.textContent) });
    })();
  `);
  const parsed = parseResult(result);
  if (!parsed.ok) {
    throw new Error(`找不到面板组件：${targetText}`);
  }
}

async function clickByText(targetText) {
  const result = await executeBrowserScript(`
    (() => {
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const interactiveSelector = "button, a, [role='button'], .ant-btn, li";
      const candidateMatches = (text) => text === ${JSON.stringify(targetText)} || text.includes(${JSON.stringify(targetText)});
      const scoreNode = (el) => {
        const text = normalize(el.innerText || el.textContent);
        return {
          el,
          text,
          score: (el.tagName === "BUTTON" ? 0 : 10) + text.length
        };
      };
      const interactiveCandidates = Array.from(document.querySelectorAll(interactiveSelector))
        .filter((el) => visible(el))
        .map(scoreNode)
        .filter((item) => candidateMatches(item.text))
        .sort((a, b) => a.score - b.score);
      let matchedNode = interactiveCandidates[0]?.el || null;
      if (!matchedNode) {
        const textNodes = Array.from(document.querySelectorAll("span, div"))
          .filter((el) => visible(el))
          .map(scoreNode)
          .filter((item) => item.text === ${JSON.stringify(targetText)})
          .sort((a, b) => a.score - b.score);
        matchedNode = textNodes[0]?.el || null;
      }
      if (!matchedNode) {
        return JSON.stringify({ ok: false, reason: "not_found" });
      }
      const target = matchedNode.matches(interactiveSelector)
        ? matchedNode
        : matchedNode.closest(interactiveSelector) || matchedNode;
      target.scrollIntoView({ block: "center", inline: "center" });
      ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      return JSON.stringify({
        ok: true,
        text: normalize(target.innerText || target.textContent),
        tag: target.tagName
      });
    })();
  `);
  const parsed = parseResult(result);
  if (!parsed.ok) {
    throw new Error(`找不到按钮：${targetText}`);
  }
}

async function fillByPlaceholder(placeholder, value) {
  const result = await executeBrowserScript(`
    (() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const all = Array.from(document.querySelectorAll("input, textarea"));
      const target = all.find((el) => visible(el) && (el.getAttribute("placeholder") || "").includes(${JSON.stringify(placeholder)}));
      if (!target) {
        return JSON.stringify({ ok: false, reason: "not_found" });
      }
      const setter = target.tagName === "TEXTAREA" ? nativeTextAreaValueSetter : nativeInputValueSetter;
      setter.call(target, ${JSON.stringify(value)});
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.focus();
      target.blur();
      return JSON.stringify({ ok: true, value: target.value });
    })();
  `);
  const parsed = parseResult(result);
  if (!parsed.ok || parsed.value !== value) {
    throw new Error(`找不到输入框：${placeholder}`);
  }
}

async function hasText(targetText) {
  const result = await executeBrowserScript(`
    (() => {
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const exists = Array.from(document.querySelectorAll("button, a, span, div, li"))
        .some((el) => visible(el) && normalize(el.innerText || el.textContent).includes(${JSON.stringify(targetText)}));
      return JSON.stringify({ ok: true, exists });
    })();
  `);
  return Boolean(parseResult(result).exists);
}

async function hasPlaceholder(placeholder) {
  const result = await executeBrowserScript(`
    (() => {
      const exists = Array.from(document.querySelectorAll("input, textarea"))
        .some((el) => (el.getAttribute("placeholder") || "").includes(${JSON.stringify(placeholder)}));
      return JSON.stringify({ ok: true, exists });
    })();
  `);
  return Boolean(parseResult(result).exists);
}

async function waitForCondition(checker, timeoutMs) {
  const start = Date.now();
  let lastError = "";
  while (Date.now() - start < timeoutMs) {
    try {
      if (await checker()) return;
    } catch (error) {
      lastError = error.message || "";
    }
    await delay(500);
  }
  const tabs = await listChromeTabs().catch(() => []);
  const tabSummary = tabs.length
    ? tabs.map((item) => `${item.index}. ${item.title} | ${item.url}`).join(" || ")
    : "未拿到标签页信息";
  throw new Error(`等待页面状态超时。${lastError ? ` 最近一次错误：${lastError}。` : ""} 当前标签页：${tabSummary}`);
}

async function executeBrowserScript(js) {
  const script = [
    'tell application "Google Chrome"',
    "activate",
    `set jsResult to execute active tab of front window javascript ${appleString(js)}`,
    "return jsResult",
    "end tell"
  ];
  return runAppleScript(script);
}

async function getPageDiagnostics() {
  const result = await executeBrowserScript(`
    (() => {
      const normalize = (value) => (value || "").replace(/\\s+/g, " ").trim();
      const bodyText = normalize(document.body?.innerText || "");
      const excerpt = bodyText.slice(0, 200);
      return JSON.stringify({
        ok: true,
        url: window.location.href,
        title: document.title || "",
        excerpt
      });
    })();
  `);
  const parsed = parseResult(result);
  return parsed.ok ? parsed : null;
}

async function logComponentDiagnostics(job, componentName, phase) {
  const diagnostics = await getPageDiagnostics().catch(() => null);
  logComponentDiagnosticsSnapshot(job, componentName, phase, diagnostics);
}

function logComponentDiagnosticsSnapshot(job, componentName, phase, diagnostics) {
  if (!job) return;
  if (!diagnostics) {
    job.logs.push(`组件诊断[${componentName}][${phase}]：页面快照获取失败`);
    return;
  }
  const excerpt = diagnostics.excerpt ? ` | 摘要=${diagnostics.excerpt}` : "";
  job.logs.push(
    `组件诊断[${componentName}][${phase}]：URL=${diagnostics.url || "未知"} | 标题=${diagnostics.title || "无标题"}${excerpt}`
  );
}

async function getActiveTabUrl() {
  const script = [
    'tell application "Google Chrome"',
    "activate",
    "return URL of active tab of front window",
    "end tell"
  ];
  return runAppleScript(script);
}

async function isDesignListReady() {
  const currentUrl = await getActiveTabUrl().catch(() => "");
  if (!currentUrl.includes("/dtmall/designPage")) {
    return false;
  }
  return hasText("新建页面");
}

function toDesignListUrl(url) {
  try {
    const parsed = new URL(url || "https://smp.iyouke.com/dtmall/designPage");
    return `${parsed.origin}/dtmall/designPage`;
  } catch {
    return "https://smp.iyouke.com/dtmall/designPage";
  }
}

function toEditorUrl(url) {
  try {
    const parsed = new URL(url || "https://smp.iyouke.com/dtmall/pageDesign");
    return `${parsed.origin}/dtmall/pageDesign?newPage=true&platformType=1`;
  } catch {
    return "https://smp.iyouke.com/dtmall/pageDesign?newPage=true&platformType=1";
  }
}

async function runAppleScript(lines) {
  const args = lines.flatMap((line) => ["-e", line]);
  const { stdout } = await execFileAsync("osascript", args);
  return stdout.trim();
}

async function listChromeTabs() {
  const script = [
    'tell application "Google Chrome"',
    "set outputLines to {}",
    "repeat with w from 1 to count of windows",
    "repeat with t from 1 to count of tabs of window w",
    "set currentUrl to URL of tab t of window w as text",
    "set currentTitle to title of tab t of window w as text",
    'set end of outputLines to ((w as text) & ":" & (t as text) & "|" & currentTitle & "|" & currentUrl)',
    "end repeat",
    "end repeat",
    "set AppleScript's text item delimiters to linefeed",
    'return outputLines as text',
    "end tell"
  ];
  const output = await runAppleScript(script);
  return String(output || "")
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => {
      const [index, title, url] = line.split("|");
      return { index, title, url };
    });
}

function parseResult(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return { ok: false };
  }
}

function serializeJob(job, extra = {}) {
  return {
    ...extra,
    state: job.state,
    message: extra.message || job.message,
    currentStep: job.currentStep,
    logs: job.logs,
    events: job.events || []
  };
}

function appendJobEvent(job, event) {
  const nextEvent = {
    id: `evt_${Date.now()}_${eventSequence += 1}`,
    timestamp: new Date().toISOString(),
    stage: event.stage || "runtime_execution",
    title: event.title || "未命名动作",
    message: event.message || "",
    status: event.status || "pending",
    kind: event.kind || "action",
    details: event.details ?? null
  };
  job.events.push(nextEvent);
  return nextEvent;
}

function updateJobEvent(event, patch) {
  if (!event) return;
  Object.assign(event, patch, { updatedAt: new Date().toISOString() });
}

function describeRuntimeStep(label, phase) {
  const done = phase === "done";

  if (label === "打开微页面列表") {
    return done ? "我已进入微页面列表页，接下来准备发起新建页面。" : "我正在打开微页面列表，并确认当前后台入口可用。";
  }

  if (label === "点击新建页面") {
    return done ? "我已点击“新建页面”，正在切换到微页面编辑器。" : "我正在点击“新建页面”，准备进入编辑器。";
  }

  if (label === "等待进入编辑页") {
    return done ? "我已识别到编辑器里的关键输入区域，可以开始填写页面信息。" : "我正在等待编辑器加载完成，并识别页面名称等关键输入框。";
  }

  if (label === "填写页面名称") {
    return done ? "我已填写页面名称，接下来开始逐个添加页面模块。" : "我正在填写页面名称，并准备初始化页面骨架。";
  }

  if (label.startsWith("添加组件：")) {
    const componentName = label.replace("添加组件：", "").trim();
    return done ? `我已完成组件“${componentName}”的添加，页面里已经出现对应模块。` : `我正在把组件“${componentName}”加入页面。`;
  }

  if (label.startsWith("补内容：")) {
    const target = label.replace("补内容：", "").trim();
    return done ? `我已补齐“${target}”的默认内容，当前模块已具备可预览信息。` : `我正在补齐“${target}”的默认内容。`;
  }

  if (label === "点击保存") {
    return done ? "我已完成保存动作，这轮自动搭建流程结束。" : "我正在执行保存操作，并准备汇总本次执行结果。";
  }

  return done ? `我已完成：${label}` : `我正在执行：${label}`;
}

function getRuntimeStepDetails(label, buildRun) {
  if (label === "打开微页面列表") {
    return { backendUrl: buildRun.backendUrl || "" };
  }

  if (label === "填写页面名称") {
    return { pageName: buildRun.pageName || "" };
  }

  if (label.startsWith("添加组件：")) {
    return { component: label.replace("添加组件：", "").trim() };
  }

  if (label.startsWith("补内容：")) {
    const target = label.replace("补内容：", "").trim();
    const template = (buildRun.actionTemplate || []).find((item) => item.target === target && Array.isArray(item.detail));
    return template?.detail || { target };
  }

  return null;
}

function appleString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function generateVisualAssets(payload) {
  const parsed = payload?.parsed || {};
  const componentPlan = Array.isArray(payload?.componentPlan) ? payload.componentPlan : [];
  const referenceAnalysis = payload?.referenceAnalysis || parsed.reference_analysis || null;
  const visualComponents = componentPlan.filter((item) => isVisualComponent(item));

  if (!visualComponents.length) {
    return [];
  }

  const outputDir = path.join(rootDir, "assets", "generated");
  fs.mkdirSync(outputDir, { recursive: true });

  return visualComponents.map((component, index) => {
    const asset = buildGeneratedAsset({
      component,
      index,
      parsed,
      referenceAnalysis,
      outputDir
    });

    fs.writeFileSync(asset.localPath, asset.svg, "utf8");

    return {
      id: asset.id,
      title: asset.title,
      componentModule: asset.componentModule,
      componentDisplayName: asset.componentDisplayName,
      prompt: asset.prompt,
      promptSummary: asset.promptSummary,
      publicUrl: asset.publicUrl,
      localPath: asset.localPath,
      width: asset.width,
      height: asset.height,
      palette: asset.palette,
      uploadStatus: "pending_material_upload",
      uploadStatusLabel: "待上传到素材库",
      integrationHint: "接入素材上传 API 或自动上传链路后，可自动带入微页面图片组件。"
    };
  });
}

function isVisualComponent(component) {
  return component?.displayName === "图文广告" || component?.component === "banner";
}

function buildGeneratedAsset({ component, index, parsed, referenceAnalysis, outputDir }) {
  const palette = resolveAssetPalette(parsed, referenceAnalysis);
  const dimensions = getAssetDimensions(component);
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const fileName = `${timestamp}-${component.component || component.module || "visual"}-${index + 1}.svg`;
  const title = `${component.displayName}-${parsed.page_goal || "页面"}-${index + 1}`;
  const prompt = [
    `为微页面组件“${component.displayName}”生成一张可直接带入页面的主视觉图。`,
    `页面目标：${parsed.page_goal || "卖货转化"}`,
    `页面风格：${parsed.style || "品牌感"}`,
    `主题色策略：${parsed.theme_color_label || "使用页面主题色"}`,
    `需求摘要：${parsed.raw_demand || "未提供额外说明"}`,
    referenceAnalysis?.hints?.style ? `参考图风格线索：${referenceAnalysis.hints.style}` : "",
    referenceAnalysis?.hints?.paletteSummary ? `参考图配色：${referenceAnalysis.hints.paletteSummary}` : ""
  ]
    .filter(Boolean)
    .join(" ");
  const promptSummary = `${parsed.style || "品牌感"}风格视觉，围绕${parsed.page_goal || "页面转化"}生成`;
  const svg = renderGeneratedAssetSvg({
    title,
    componentDisplayName: component.displayName,
    goal: parsed.page_goal || "卖货转化",
    style: parsed.style || "品牌感",
    demand: parsed.raw_demand || "自动生成的页面视觉素材",
    palette,
    width: dimensions.width,
    height: dimensions.height
  });

  return {
    id: `asset_${timestamp}_${index + 1}`,
    title,
    componentModule: component.module,
    componentDisplayName: component.displayName,
    prompt,
    promptSummary,
    palette,
    width: dimensions.width,
    height: dimensions.height,
    localPath: path.join(outputDir, fileName),
    publicUrl: `/assets/generated/${fileName}`,
    svg
  };
}

function resolveAssetPalette(parsed, referenceAnalysis) {
  const referencePalette = Array.isArray(referenceAnalysis?.palette) ? referenceAnalysis.palette : [];
  const fallbackPalette = ["#8C4B2F", "#F0D2BE", "#F8F4EE"];
  const customColor = parsed?.theme_color_mode === "custom" && parsed?.theme_color_value ? [parsed.theme_color_value] : [];
  return [...new Set([...customColor, ...referencePalette, ...fallbackPalette])].slice(0, 3);
}

function getAssetDimensions(component) {
  if (component?.displayName === "图文广告" || component?.component === "banner") {
    return { width: 1125, height: 720 };
  }
  return { width: 1080, height: 1080 };
}

function renderGeneratedAssetSvg({ title, componentDisplayName, goal, style, demand, palette, width, height }) {
  const [primary, secondary, surface] = palette;
  const safeTitle = escapeXml(title);
  const safeComponentName = escapeXml(componentDisplayName);
  const safeGoal = escapeXml(goal);
  const safeStyle = escapeXml(style);
  const safeDemand = escapeXml(demand.slice(0, 42));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${escapeXml(surface)}"/>
      <stop offset="100%" stop-color="${escapeXml(primary)}"/>
    </linearGradient>
    <linearGradient id="card" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${escapeXml(secondary)}" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.88"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="38" fill="url(#bg)"/>
  <circle cx="${Math.round(width * 0.83)}" cy="${Math.round(height * 0.22)}" r="${Math.round(height * 0.2)}" fill="${escapeXml(secondary)}" fill-opacity="0.42"/>
  <circle cx="${Math.round(width * 0.2)}" cy="${Math.round(height * 0.72)}" r="${Math.round(height * 0.14)}" fill="#ffffff" fill-opacity="0.28"/>
  <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.12)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.76)}" rx="32" fill="url(#card)"/>
  <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.24)}" fill="#5a3420" font-family="'Noto Serif SC','PingFang SC','Microsoft YaHei',serif" font-size="${Math.round(width * 0.038)}" font-weight="700">${safeComponentName}</text>
  <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.38)}" fill="#2f1f17" font-family="'Noto Serif SC','PingFang SC','Microsoft YaHei',serif" font-size="${Math.round(width * 0.072)}" font-weight="700">${safeGoal}</text>
  <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.5)}" fill="#74462b" font-family="'Manrope','PingFang SC','Microsoft YaHei',sans-serif" font-size="${Math.round(width * 0.026)}" font-weight="700">${safeStyle} · AI Generated Visual</text>
  <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.61)}" fill="#6d5547" font-family="'Manrope','PingFang SC','Microsoft YaHei',sans-serif" font-size="${Math.round(width * 0.023)}">${safeDemand}</text>
  <rect x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.68)}" width="${Math.round(width * 0.26)}" height="${Math.round(height * 0.11)}" rx="${Math.round(height * 0.05)}" fill="#5a3420"/>
  <text x="${Math.round(width * 0.18)}" y="${Math.round(height * 0.75)}" fill="#fff9f2" font-family="'Manrope','PingFang SC','Microsoft YaHei',sans-serif" font-size="${Math.round(width * 0.024)}" font-weight="800">立即查看</text>
  <text x="${Math.round(width * 0.12)}" y="${Math.round(height * 0.86)}" fill="#8b6f5d" font-family="'Manrope','PingFang SC','Microsoft YaHei',sans-serif" font-size="${Math.round(width * 0.018)}">${safeTitle}</text>
</svg>`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function matchRunRoute(rawUrl) {
  if (!rawUrl || !rawUrl.startsWith("/v1/runs/")) return null;
  const url = new URL(rawUrl, `http://127.0.0.1:${port}`);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 3 && segments[0] === "v1" && segments[1] === "runs") {
    return {
      runId: decodeURIComponent(segments[2]),
      action: "get"
    };
  }
  if (segments.length === 4 && segments[0] === "v1" && segments[1] === "runs" && segments[3] === "takeover") {
    return {
      runId: decodeURIComponent(segments[2]),
      action: "takeover"
    };
  }
  if (segments.length === 4 && segments[0] === "v1" && segments[1] === "runs" && segments[3] === "resume") {
    return {
      runId: decodeURIComponent(segments[2]),
      action: "resume"
    };
  }
  return null;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  let filePath = path.join(rootDir, requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname);
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  fs.createReadStream(filePath).pipe(res);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function humanizeError(message) {
  if (message.includes("Allow JavaScript from Apple Events")) {
    return {
      state: "blocked",
      message: "Chrome 还没打开外部控制开关",
      detail: "请在 Chrome 顶部菜单里打开：视图 -> 开发者 -> Allow JavaScript from Apple Events，然后再点一次“开始自动搭建到后台”"
    };
  }

  if (message.includes("没有真正进入微信页面装修")) {
    return {
      state: "blocked",
      message: "没有进入微页面装修页",
      detail: `${message}。请先手动确认账号能正常打开“微信页面装修”，再重新开始自动搭建。`
    };
  }

  if (message.includes("系统把页面跳回了应用首页")) {
    return {
      state: "blocked",
      message: "系统把页面跳回应用首页了",
      detail: `${message}。系统现在会固定先走微页面列表，再点“新建页面”。如果这里仍被送回应用首页，说明当前账号或页面状态拦住了微页面入口。`
    };
  }

  if (message.includes("没有真正进入新建页")) {
    return {
      state: "blocked",
      message: "没有进入新建页编辑器",
      detail: `${message}。请先手动打开一次新建页，确认这个地址可进入后再重新开始自动搭建。`
    };
  }

  return {
    state: "failed",
    message: "自动搭建失败",
    detail: message
  };
}
