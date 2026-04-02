const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT || 8001);
const rootDir = __dirname;
const jobs = new Map();

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
    if (req.method === "POST" && req.url === "/api/build/start") {
      const body = await readJson(req);
      const jobId = `job_${Date.now()}`;
      const job = {
        id: jobId,
        state: "running",
        message: "准备开始",
        currentStep: "准备开始",
        logs: ["已收到自动搭建请求"],
        buildRun: body
      };
      jobs.set(jobId, job);
      runBuild(job).catch((error) => {
        const friendly = humanizeError(error.message || "");
        job.state = friendly.state;
        job.message = friendly.message;
        job.currentStep = "已停止";
        job.logs.push(friendly.detail);
      });
      return sendJson(res, 200, {
        jobId,
        state: job.state,
        message: "已开始自动搭建",
        currentStep: job.currentStep,
        logs: job.logs
      });
    }

    if (req.method === "GET" && req.url && req.url.startsWith("/api/build/status")) {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const jobId = url.searchParams.get("id");
      const job = jobId ? jobs.get(jobId) : null;
      if (!job) {
        return sendJson(res, 404, { message: "任务不存在" });
      }
      return sendJson(res, 200, {
        id: job.id,
        state: job.state,
        message: job.message,
        currentStep: job.currentStep,
        logs: job.logs
      });
    }

    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, { message: error.message || "服务异常" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Demo server running at http://127.0.0.1:${port}`);
});

async function runBuild(job) {
  const { buildRun } = job;
  const actionTemplate = Array.isArray(buildRun.actionTemplate) ? buildRun.actionTemplate : [];
  const steps = [
    ["打开编辑器", async () => {
      await ensureBackendTab(toEditorUrl(buildRun.backendUrl));
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
    ...buildActionSteps(actionTemplate, buildRun),
    ["点击保存", async () => clickByText("保 存")]
  ];

  for (const [label, action] of steps) {
    job.currentStep = label;
    job.message = "正在执行";
    job.logs.push(label);
    await action();
  }

  job.state = "done";
  job.message = "已完成自动搭建";
  job.currentStep = "全部完成";
  job.logs.push("自动搭建已完成");
}

function buildActionSteps(actionTemplate, buildRun) {
  return actionTemplate
    .filter((item) => item.step && !["open_list_page", "open_editor", "open_editor_direct", "set_page_name", "preview_page", "save_page"].includes(item.step))
    .map((item) => {
      if (item.step.startsWith("add_component_")) {
        return [
          `添加组件：${item.target}`,
          async () => {
            await clickPaletteComponent(item.target);
            await delay(700);
            const currentUrl = await getActiveTabUrl().catch(() => "");
            if (!currentUrl.includes("/dtmall/pageDesign")) {
              throw new Error(`添加组件时页面跳转走了，当前停留在：${currentUrl || "未知页面"}`);
            }
          }
        ];
      }

      if (item.step.startsWith("fill_component_")) {
        return [
          `补内容：${item.target}`,
          async () => runFillAction(item, buildRun)
        ];
      }

      return [
        item.step,
        async () => delay(200)
      ];
    });
}

async function runFillAction(item, buildRun) {
  if (item.action === "richtext_fill") {
    await fillRichText(buildRun.pageGoal);
    return;
  }

  if (item.action === "link_nav_fill") {
    await fillLinkNavigation("导航1-子页面");
    return;
  }

  if (item.action === "material_pick") {
    await fillBannerImage();
    return;
  }

  if (item.action === "coupon_pick") {
    await fillCoupon();
    return;
  }

  if (item.action === "product_pick") {
    await fillProduct();
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

async function fillBannerImage() {
  // 点击"添加图片"触发按钮
  await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const trigger = Array.from(document.querySelectorAll("div, span, button"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent) === "添加 0/10 图片");
      if (trigger) trigger.click();
      return JSON.stringify({ ok: !!trigger });
    })();
  `);
  // 等弹窗/图片管理器出现
  await delay(1200);
  const result = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const image = Array.from(document.querySelectorAll("img"))
        .find((img) => visible(img) && !/logo\\.svg|img_placeholder|ai-icon-default/.test(img.src));
      if (!image) {
        return JSON.stringify({ ok: false, reason: "image_not_found" });
      }
      image.click();
      const confirm = Array.from(document.querySelectorAll("button"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent) === "确 定");
      if (confirm) confirm.click();
      const bodyText = normalize(document.body.innerText || "");
      return JSON.stringify({ ok: true, filled: bodyText.includes("添加 1/10 图片") || bodyText.includes("添加1/10图片") });
    })();
  `);
  const parsed = parseResult(result);
  if (!parsed.ok || !parsed.filled) {
    throw new Error("图文广告图片未补充成功");
  }
}

async function fillProduct() {
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
  await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const search = Array.from(document.querySelectorAll("button"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent) === "查 询");
      if (search) search.click();
      return JSON.stringify({ ok: !!search });
    })();
  `);
  // 等查询结果
  await delay(1200);
  const result = await executeBrowserScript(`
    (() => {
      const normalize = (v) => (v || "").replace(/\\s+/g, " ").trim();
      const visible = (el) => { const r = el.getBoundingClientRect(), s = window.getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const row = Array.from(document.querySelectorAll("tr.ant-table-row"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent).length > 0);
      if (!row) {
        return JSON.stringify({ ok: false, reason: "row_not_found" });
      }
      row.click();
      const confirm = Array.from(document.querySelectorAll("button"))
        .find((el) => visible(el) && normalize(el.innerText || el.textContent) === "确 定");
      if (confirm) confirm.click();
      const bodyText = normalize(document.body.innerText || "");
      return JSON.stringify({ ok: true, filled: bodyText.includes("添加商品（1/ 100）") || bodyText.includes("已选 1 件") || bodyText.includes("已选1件") });
    })();
  `);
  const parsed = parseResult(result);
  if (!parsed.ok || !parsed.filled) {
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
  const script = [
    'tell application "Google Chrome"',
    "activate",
    `tell front window to make new tab with properties {URL:${appleString(url)}}`,
    "set active tab index of front window to (count of tabs of front window)",
    "set index of front window to 1",
    "end tell"
  ];
  await runAppleScript(script);
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

function appleString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
