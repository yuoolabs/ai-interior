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
- `POST /v1/page/publish`
- `GET /v1/runs/:id`
- `POST /v1/runs/:id/takeover`（人工接管）
- `POST /v1/runs/:id/resume`（断点续跑）
- `GET /v1/system/health`
- `GET /v1/system/config`
- `GET /v1/system/rollout`
- `POST /v1/system/preflight`
- `POST /v1/system/profile/validate`

## 运行
```bash
cd demo
npm test
npm start
```
打开 `http://127.0.0.1:8001`

## 环境变量（可选）
- `MODEL_PROVIDER=mock|openai`（默认 `mock`）
- `MODEL_NAME=gpt-5-mini`
- `OPENAI_API_KEY=...`
- `MODEL_BASE_URL=https://api.openai.com/v1`
- `MICROPAGE_ADAPTER_MODE=mock|real|ui_only`（默认 `mock`）
- `MICROPAGE_API_BASE=...`
- `MICROPAGE_API_TOKEN=...`
- `MICROPAGE_API_ENDPOINTS_JSON=...`（可选，用 JSON 覆盖真实接口路径与字段映射）
- `MICROPAGE_API_PROFILE_FILE=...`（可选，从文件加载接口映射配置）
- `MICROPAGE_API_HEALTH_PATH=/health`（可选，real 模式预检连通性探测路径）
- `ENABLE_REAL_AUTO_PUBLISH=true|false`（real 模式自动发布总开关，默认 false）
- `AUTOPUBLISH_TENANT_ALLOWLIST=tenant_a,tenant_b`（可选，real 模式发布灰度白名单）

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
```

如果你希望按“真实后端字段”快速改一版，建议从这份模板开始：

`backend/config/micropage-api-profile.real-template.json`

推荐步骤：
1. 用你们真实接口替换 `path`。
2. 用你们真实请求字段替换每个 `payloadTemplate` 的 key。
3. 用你们真实响应结构替换 `parseTemplate`（重点是 `create_page.pageId` 和 `uploadMaterial.materialId`）。
4. 调用 `POST /v1/system/profile/validate` 做配置校验。
5. 调用 `POST /v1/system/preflight` 确认 real 模式可连通。

profile 校验示例：
```bash
curl -X POST http://127.0.0.1:8001/v1/system/profile/validate \
  -H 'Content-Type: application/json' \
  -d @backend/config/micropage-api-profile.example.json
```

## 说明
- 默认 `mock` 模式可离线跑通全链路，便于先做流程验证。
- 切换到 `real` 模式后，`page-adapter` 会优先调用业务 API；失败时自动降级到 UI fallback（若启用）。
- 审计日志默认写入：`demo/logs/audit-events.log`。
- 可通过 `GET /v1/system/health` 查看当前模型/适配器模式与配置有效性。
- `GET /v1/runs/:id` 已返回 `failure_reason`、`retry_suggestions`、`audit_trace_id`，可直接用于失败诊断与重试引导。
