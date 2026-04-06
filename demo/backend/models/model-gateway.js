class ModelGateway {
  constructor(options = {}) {
    this.provider = options.provider || process.env.MODEL_PROVIDER || "mock";
    this.model = options.model || process.env.MODEL_NAME || defaultModelByProvider(this.provider);
    this.apiKey = options.apiKey || process.env.MODEL_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || "";
    this.baseUrl = options.baseUrl || process.env.MODEL_BASE_URL || defaultBaseUrlByProvider(this.provider);
  }

  async generateStructured({ capability, input, schema, fallback }) {
    if (this.provider !== "mock") {
      try {
        const raw = await this.callProvider({ capability, input, schema });
        const parsed = this.safeJson(raw);
        if (parsed) {
          return this.coerceSchema(parsed, schema);
        }
      } catch (error) {
        return {
          ...fallback(input),
          _modelFallback: true,
          _fallbackReason: error.message || "model_call_failed"
        };
      }
    }

    return {
      ...fallback(input),
      _modelFallback: true,
      _fallbackReason: this.provider === "mock" ? "mock_provider" : "provider_disabled"
    };
  }

  async generateImagePrompt({ prompt, fallback }) {
    if (this.provider !== "mock") {
      try {
        const raw = await this.callProvider({
          capability: "image_prompt",
          input: { prompt },
          schema: {
            type: "object",
            required: ["prompt"],
            properties: {
              prompt: { type: "string" }
            }
          }
        });
        const parsed = this.safeJson(raw);
        if (parsed?.prompt) return parsed.prompt;
      } catch {
        return fallback(prompt);
      }
    }
    return fallback(prompt);
  }

  async callProvider({ capability, input, schema }) {
    if (!this.apiKey) {
      throw new Error("missing_api_key");
    }

    if (this.provider === "gemini") {
      return this.callGeminiProvider({ capability, input, schema });
    }
    return this.callOpenAIProvider({ capability, input, schema });
  }

  async preflight(options = {}) {
    const strict = options.strict === true;
    const provider = String(this.provider || "mock").toLowerCase();
    const summary = {
      provider,
      model: this.model,
      baseUrl: this.baseUrl || "",
      hasApiKey: Boolean(this.apiKey),
      checks: []
    };

    if (!["mock", "openai", "gemini"].includes(provider)) {
      summary.checks.push({
        name: "provider_check",
        ok: false,
        message: `不支持的模型供应商: ${provider}`
      });
      return {
        ok: false,
        ...summary
      };
    }

    if (provider === "mock") {
      summary.checks.push({
        name: "provider_check",
        ok: true,
        message: "当前 provider=mock，仅执行规则模板，不调用外部模型。"
      });
      return {
        ok: true,
        ...summary
      };
    }

    if (!summary.hasApiKey) {
      summary.checks.push({
        name: "credentials_check",
        ok: false,
        message: "缺少模型 API Key（MODEL_API_KEY / 对应供应商 KEY）"
      });
      return {
        ok: false,
        ...summary
      };
    }

    if (!summary.baseUrl) {
      summary.checks.push({
        name: "base_url_check",
        ok: false,
        message: "缺少 MODEL_BASE_URL，无法探测模型连通性"
      });
      return {
        ok: false,
        ...summary
      };
    }

    const connectivity = await this.checkConnectivity().catch((error) => ({
      name: "connectivity_check",
      ok: false,
      message: `模型连通性检查失败: ${sanitizeModelError(error.message || "unknown_error")}`
    }));
    summary.checks.push(connectivity);

    const allPass = summary.checks.every((item) => item.ok);
    if (!allPass && strict) {
      return {
        ok: false,
        ...summary
      };
    }

    return {
      ok: allPass,
      ...summary
    };
  }

  async checkConnectivity(options = {}) {
    const timeoutMs = Number(options.timeoutMs || process.env.MODEL_CONNECTIVITY_TIMEOUT_MS || 12000);
    const provider = String(this.provider || "").toLowerCase();
    const baseUrl = String(this.baseUrl || "").replace(/\/+$/, "");

    if (provider === "openai") {
      const response = await fetchWithTimeout(`${baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        }
      }, timeoutMs);

      if (!response.ok) {
        const body = await response.text();
        return {
          name: "connectivity_check",
          ok: false,
          message: `OpenAI 网关不可用: ${response.status} ${sanitizeModelError((body || "").slice(0, 120))}`
        };
      }

      return {
        name: "connectivity_check",
        ok: true,
        message: "OpenAI 模型网关连通成功"
      };
    }

    if (provider === "gemini") {
      const url = `${baseUrl}/models?key=${encodeURIComponent(this.apiKey)}`;
      const response = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);

      if (!response.ok) {
        const body = await response.text();
        return {
          name: "connectivity_check",
          ok: false,
          message: `Gemini 网关不可用: ${response.status} ${sanitizeModelError((body || "").slice(0, 120))}`
        };
      }

      return {
        name: "connectivity_check",
        ok: true,
        message: "Gemini 模型网关连通成功"
      };
    }

    return {
      name: "connectivity_check",
      ok: false,
      message: `未知 provider: ${provider}`
    };
  }

  async callOpenAIProvider({ capability, input, schema }) {
    const userContent = [
      {
        type: "input_text",
        text: JSON.stringify({
          input: sanitizeModelInput(input),
          schema
        })
      }
    ];

    const maybeImage = extractImageDataUrl(input);
    if (maybeImage) {
      userContent.push({
        type: "input_image",
        image_url: maybeImage
      });
    }

    const response = await fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: buildSystemPrompt(capability)
              }
            ]
          },
          {
            role: "user",
            content: userContent
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: `${capability}_schema`,
            strict: true,
            schema
          }
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`provider_error_${response.status}:${body.slice(0, 200)}`);
    }

    const result = await response.json();
    const text = result?.output_text || result?.output?.[0]?.content?.[0]?.text || "";
    if (!text) {
      throw new Error("empty_model_output");
    }
    return text;
  }

  async callGeminiProvider({ capability, input, schema }) {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const parts = [
      {
        text: JSON.stringify({
          input: sanitizeModelInput(input),
          schema
        })
      }
    ];

    const inlineImage = parseDataUrlToInlineData(extractImageDataUrl(input));
    if (inlineImage) {
      parts.push({
        inline_data: inlineImage
      });
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          role: "system",
          parts: [{ text: buildSystemPrompt(capability) }]
        },
        contents: [
          {
            role: "user",
            parts
          }
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: toGeminiSchema(schema)
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`provider_error_${response.status}:${body.slice(0, 200)}`);
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.find((part) => typeof part?.text === "string")?.text || "";
    if (!text) {
      throw new Error("empty_model_output");
    }
    return text;
  }

  safeJson(raw) {
    try {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }

  coerceSchema(value, schema) {
    if (!schema || schema.type !== "object") return value;
    const output = {};
    const properties = schema.properties || {};
    Object.entries(properties).forEach(([key, def]) => {
      const current = value?.[key];
      if (current === undefined || current === null) return;
      if (def.type === "array" && Array.isArray(current)) output[key] = current;
      else if (def.type === "object" && typeof current === "object" && !Array.isArray(current)) output[key] = current;
      else if (def.type === "number") output[key] = Number(current);
      else if (def.type === "boolean") output[key] = Boolean(current);
      else output[key] = String(current);
    });

    (schema.required || []).forEach((key) => {
      if (output[key] === undefined) {
        if (properties[key]?.type === "array") output[key] = [];
        else if (properties[key]?.type === "object") output[key] = {};
        else if (properties[key]?.type === "number") output[key] = 0;
        else if (properties[key]?.type === "boolean") output[key] = false;
        else output[key] = "";
      }
    });

    return output;
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`timeout_after_${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeModelError(text) {
  return String(text || "")
    .replace(/(key=)[^&\s]+/gi, "$1***")
    .replace(/(api[_-]?key|token|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=***")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSystemPrompt(capability) {
  const base = "你是电商微页面 AI 编排助手。输出必须严格遵循 JSON Schema，且仅输出 JSON。";
  if (capability === "reference_understanding") {
    return `${base} 当前任务是解析参考图并抽取页面风格、模块和分区顺序。模块名称必须使用系统规范 key，例如 banner、coupon、product_grid、cta。`;
  }
  if (capability === "design_blueprint") {
    return `${base} 当前任务是根据需求生成微页面设计稿蓝图。必须给出可落地的模块顺序和分区目标。`;
  }
  if (capability === "intent_parse") {
    return `${base} 当前任务是解析用户需求并输出结构化意图。`;
  }
  if (capability === "image_prompt") {
    return `${base} 当前任务是生成组件素材提示词，保持简洁可执行。`;
  }
  return `${base} 能力: ${capability}。`;
}

function sanitizeModelInput(input) {
  if (!input || typeof input !== "object") return input;
  const cloned = { ...input };
  if (typeof cloned.imageDataUrl === "string" && cloned.imageDataUrl.length > 120) {
    cloned.imageDataUrl = `${cloned.imageDataUrl.slice(0, 120)}...`;
  }
  return cloned;
}

function extractImageDataUrl(input) {
  const imageDataUrl = input?.imageDataUrl;
  if (typeof imageDataUrl !== "string") return null;
  if (!imageDataUrl.startsWith("data:image/")) return null;
  return imageDataUrl;
}

function parseDataUrlToInlineData(dataUrl) {
  if (!dataUrl) return null;
  const matched = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!matched) return null;
  return {
    mime_type: matched[1],
    data: matched[2]
  };
}

function defaultModelByProvider(provider) {
  if (provider === "gemini") return "gemini-2.5-flash";
  return "gpt-5-mini";
}

function defaultBaseUrlByProvider(provider) {
  if (provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta";
  return "https://api.openai.com/v1";
}

function toGeminiSchema(schema) {
  if (!schema || typeof schema !== "object") {
    return {
      type: "OBJECT",
      properties: {}
    };
  }
  return convertJsonSchemaNode(schema);
}

function convertJsonSchemaNode(node) {
  const sourceType = String(node?.type || "object").toLowerCase();
  const target = {};
  const typeMap = {
    object: "OBJECT",
    array: "ARRAY",
    string: "STRING",
    number: "NUMBER",
    integer: "INTEGER",
    boolean: "BOOLEAN"
  };
  target.type = typeMap[sourceType] || "STRING";

  if (sourceType === "object") {
    const properties = node?.properties || {};
    target.properties = {};
    Object.entries(properties).forEach(([key, value]) => {
      target.properties[key] = convertJsonSchemaNode(value);
    });
    if (Array.isArray(node?.required) && node.required.length) {
      target.required = [...node.required];
    }
  }

  if (sourceType === "array") {
    target.items = convertJsonSchemaNode(node?.items || { type: "string" });
  }

  return target;
}

module.exports = {
  ModelGateway
};
