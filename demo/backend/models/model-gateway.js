class ModelGateway {
  constructor(options = {}) {
    this.provider = options.provider || process.env.MODEL_PROVIDER || "mock";
    this.model = options.model || process.env.MODEL_NAME || "gpt-5-mini";
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    this.baseUrl = options.baseUrl || process.env.MODEL_BASE_URL || "https://api.openai.com/v1";
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
                text: `你是电商微页面AI编排助手。能力: ${capability}。只输出 JSON。`
              }
            ]
          },
          {
            role: "user",
            content: [{ type: "input_text", text: JSON.stringify({ input, schema }) }]
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

module.exports = {
  ModelGateway
};
