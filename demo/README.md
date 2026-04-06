# 微页面 AI 装修平台（Production-Style Demo）

## 升级后的能力
- 输入需求（文字 + 行业/目标/风格 + 可选参考图）
- 通过 `AI Orchestrator` 统一编排：意图解析 -> 设计生成 -> 素材生成上传 -> 页面执行 -> 发布
- 支持 `API 优先 + UI 自动化兜底` 的执行策略
- 支持发布前风控校验、全链路审计、运行态回放
- 前端仅负责需求采集与运行状态展示，不再承载核心业务决策

## 新架构目录
- `demo/backend/index.js`：后端能力装配
- `demo/backend/models/model-gateway.js`：统一模型网关（可切换 provider）
- `demo/backend/services/orchestrator.js`：总编排入口
- `demo/backend/services/intent-service.js`：结构化意图解析
- `demo/backend/services/design-service.js`：页面方案生成
- `demo/backend/services/asset-pipeline.js`：素材生成 + 质检 + 入库
- `demo/backend/services/page-adapter.js`：微页面 API 适配（含 UI fallback）
- `demo/backend/services/state-machine.js`：执行状态机（重试/状态流转）
- `demo/backend/services/risk-engine.js`：发布前风控
- `demo/backend/services/audit-service.js`：审计日志
- `demo/backend/store/run-store.js`：运行态存储

## API Contract（v1）
- `POST /v1/intent/parse`
- `POST /v1/design/generate`
- `POST /v1/assets/generate-and-upload`
- `POST /v1/page/execute`
- `POST /v1/page/auto-build`（一键：需求 -> 设计稿 -> 素材 -> 自动装修）
- `POST /v1/page/publish`
- `GET /v1/runs/:id`
- `POST /v1/runs/:id/takeover`（人工接管）
- `POST /v1/runs/:id/resume`（断点续跑）
- `GET /v1/system/health`
- `GET /v1/system/config`
- `POST /v1/system/config/save`
- `GET /v1/system/rollout`
- `GET /v1/system/component-skins`
- `POST /v1/system/preflight`
- `POST /v1/system/model/preflight`
- `POST /v1/system/profile/validate`

## 运行
```bash
cd demo
npm test
npm start
```
打开 `http://127.0.0.1:8001`

推荐：先复制本地配置文件，再启动
```bash
cd demo
cp .env.local.example .env.local
# 编辑 .env.local，填入 GEMINI_API_KEY 等配置
npm run start:ui
```

## 环境变量（可选）
- `MODEL_PROVIDER=mock|openai|gemini`（默认 `mock`）
- `MODEL_NAME=gpt-5-mini`
- `MODEL_API_KEY=...`（推荐统一使用；也兼容 `OPENAI_API_KEY` / `GEMINI_API_KEY`）
- `OPENAI_API_KEY=...`
- `GEMINI_API_KEY=...`
- `MODEL_BASE_URL=https://api.openai.com/v1`
- `MODEL_CONNECTIVITY_TIMEOUT_MS=12000`（可选，模型连通性预检超时毫秒）
- `MICROPAGE_ADAPTER_MODE=mock|real|ui_only`（默认 `mock`）
- `MICROPAGE_API_BASE=...`
- `MICROPAGE_API_TOKEN=...`
- `MICROPAGE_API_ENDPOINTS_JSON=...`（可选，用 JSON 覆盖真实接口路径与字段映射）
- `MICROPAGE_API_PROFILE_FILE=...`（可选，从文件加载接口映射配置）
- `MICROPAGE_API_HEALTH_PATH=/health`（可选，real 模式预检连通性探测路径）
- `ENABLE_REAL_AUTO_PUBLISH=true|false`（real 模式自动发布总开关，默认 false）
- `AUTOPUBLISH_TENANT_ALLOWLIST=tenant_a,tenant_b`（可选，real 模式发布灰度白名单）
- `MICROPAGE_STRICT_COMPONENT_POLICY=true|false`（默认 true，强制只用允许组件）
- `MICROPAGE_ALLOWED_MODULES=banner,coupon,product_grid,cta`（可选，限定可用模块）
- `MICROPAGE_ALLOWED_COMPONENTS=banner,coupon,product,linkNav`（可选，限定可用组件 key）
- `MICROPAGE_COMPONENT_SKIN_FILE=backend/config/component-skin-map.json`（可选，组件皮肤映射文件）
- `APP_ENV_FILE=.env.local`（可选，默认自动读取 `demo/.env.local`）

## 常用启动命令
```bash
cd demo

# 自动读取 .env.local
npm start

# 强制 mock（仅流程演示，不真实创建）
npm run start:mock

# UI 自动化（会尝试真实在后台页面执行）
npm run start:ui

# 真实 API 直连
npm run start:real
```

## Gemini 配置（推荐）
1. 在 `demo/.env.local` 设置：
```bash
MODEL_PROVIDER=gemini
MODEL_NAME=gemini-2.5-flash
GEMINI_API_KEY=你的真实key
MICROPAGE_ADAPTER_MODE=ui_only
```
2. 启动服务：
```bash
cd demo
npm run start:ui
```
3. 验证生效：
```bash
curl http://127.0.0.1:8001/v1/system/config
```
确认返回里是：
- `system.model.provider = gemini`
- `system.model.hasApiKey = true`
- `system.adapter.mode = ui_only`

也可以在页面内通过「模型与执行配置」区域直接保存配置，接口为：

`POST /v1/system/config/save`

保存后页面会自动触发 `POST /v1/system/preflight`，并展示模式/鉴权/API/发布策略诊断明细。
其中 `preflight` 已包含模型网关连通性检查；也可单独调用 `POST /v1/system/model/preflight` 查看模型侧诊断。

如果外网受限，请在页面配置中填写“模型 Base URL（可填内网代理）”，把请求改走你们可达的模型网关。
若诊断出现 `timeout_after_xxxms`，通常是网络不可达或被防火墙拦截，请优先切换到可达的内网/代理网关。

页面支持“必须使用大模型（失败不降级）”开关；开启后如果模型调用失败会直接返回 422，不再静默回退规则模板。

### 真实接口映射示例
```bash
export MICROPAGE_ADAPTER_MODE=real
export MICROPAGE_API_BASE=https://your-domain.com
export MICROPAGE_API_TOKEN=xxxx
export MICROPAGE_API_ENDPOINTS_JSON='{
  "uploadMaterial": {
    "path": "/v2/media/upload",
    "payloadTemplate": {
      "filePath": "{{input.filePath}}",
      "name": "{{input.title}}"
    },
    "parseTemplate": {
      "materialId": "{{res.data.materialId}}",
      "status": "uploaded",
      "statusLabel": "已上传素材库",
      "integrationHint": "通过自定义接口完成上传"
    }
  },
  "actions": {
    "create_page": { "path": "/v2/pages/create" },
    "set_page_name": { "path": "/v2/pages/{{runtime.pageId}}/name" },
    "add_component": { "path": "/v2/pages/{{runtime.pageId}}/components/add" },
    "fill_component": { "path": "/v2/pages/{{runtime.pageId}}/components/fill" },
    "save_page": { "path": "/v2/pages/{{runtime.pageId}}/save" },
    "publish_page": { "path": "/v2/pages/{{runtime.pageId}}/publish" }
  }
}'
```

联调前建议先跑预检：
```bash
curl -X POST http://127.0.0.1:8001/v1/system/preflight \
  -H 'Content-Type: application/json' \
  -d '{"strict": true}'
```

也可以一键执行：
```bash
cd demo
npm run preflight
```

如果你要在 `real` 模式下使用 profile 文件：
```bash
export MICROPAGE_ADAPTER_MODE=real
export MICROPAGE_API_PROFILE_FILE=backend/config/micropage-api-profile.example.json
export MICROPAGE_API_BASE=https://your-domain.com
export MICROPAGE_API_TOKEN=xxxx
export ENABLE_REAL_AUTO_PUBLISH=true
export AUTOPUBLISH_TENANT_ALLOWLIST=tenant_a,tenant_b
export MICROPAGE_STRICT_COMPONENT_POLICY=true
export MICROPAGE_ALLOWED_MODULES=banner,benefit_bar,coupon,countdown,product_grid,member_form,event_form,search_entry,live_room,cta
export MICROPAGE_ALLOWED_COMPONENTS=banner,title,coupon,limit,product,handleMember,bookEvent,search,videoChannel,linkNav
```

如果你希望按“真实后端字段”快速改一版，建议从这份模板开始：

`backend/config/micropage-api-profile.real-template.json`

推荐步骤：
1. 用你们真实接口替换 `path`。
2. 用你们真实请求字段替换每个 `payloadTemplate` 的 key。
3. 用你们真实响应结构替换 `parseTemplate`（重点是 `create_page.pageId` 和 `uploadMaterial.materialId`）。
4. 调用 `POST /v1/system/profile/validate` 做配置校验。
5. 调用 `POST /v1/system/preflight` 确认 real 模式可连通。

### 组件 1:1 样式皮肤映射
默认映射文件：

`backend/config/component-skin-map.json`

真实截图目录：

`assets/component-skins/`

把每个组件截图按组件 key 命名后放入目录（例如 `banner.png`、`coupon.png`、`product.png`），前端预估效果会优先使用真实截图渲染。  
可通过 `GET /v1/system/component-skins` 查看皮肤配置与截图可用状态。

profile 校验示例：
```bash
curl -X POST http://127.0.0.1:8001/v1/system/profile/validate \
  -H 'Content-Type: application/json' \
  -d @backend/config/micropage-api-profile.example.json
```

## 说明
- 默认 `mock` 模式可离线跑通全链路，便于先做流程验证。
- 使用大模型直连时，建议配置：
  - `MODEL_PROVIDER=openai`
  - `OPENAI_API_KEY=...`
  - 可选 `MODEL_NAME=gpt-5-mini` 或你们指定模型
- 使用 Gemini 时，建议配置：
  - `MODEL_PROVIDER=gemini`
  - `GEMINI_API_KEY=...`（或统一用 `MODEL_API_KEY`）
  - 可选 `MODEL_NAME=gemini-2.5-flash`
  - 可选 `MODEL_BASE_URL=https://generativelanguage.googleapis.com/v1beta`
- 切换到 `real` 模式后，`page-adapter` 会优先调用业务 API；失败时自动降级到 UI fallback（若启用）。
- 审计日志默认写入：`demo/logs/audit-events.log`。
- 可通过 `GET /v1/system/health` 查看当前模型/适配器模式与配置有效性。
- `GET /v1/runs/:id` 已返回 `failure_reason`、`retry_suggestions`、`audit_trace_id`，可直接用于失败诊断与重试引导。
- 当启用严格组件策略时，AI 只会在允许清单内选组件；超出清单会标记 `unresolved` 并阻断自动发布。

### 一键自动装修接口示例
```bash
curl -X POST http://127.0.0.1:8001/v1/page/auto-build \
  -H 'Content-Type: application/json' \
  -d '{
    "demand":"做一个大促卖货页，突出优惠券和爆款商品",
    "industry":"美妆",
    "style":"大促",
    "require_model": true,
    "auto_publish":true,
    "auth_level":"service_account"
  }'
```
