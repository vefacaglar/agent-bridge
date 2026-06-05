import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

function parseModelsResponse(data: any): string[] {
  if (!data) return [];
  
  // If it's a direct array
  if (Array.isArray(data)) {
    return data.map((m: any) => typeof m === 'string' ? m : (m.id || m.name || m.model || '')).filter(Boolean);
  }
  
  // If it has a .data array (standard OpenAI)
  if (data.data && Array.isArray(data.data)) {
    return data.data.map((m: any) => typeof m === 'string' ? m : (m.id || m.name || m.model || '')).filter(Boolean);
  }
  
  // If it has a .models array (Ollama style sometimes)
  if (data.models && Array.isArray(data.models)) {
    return data.models.map((m: any) => typeof m === 'string' ? m : (m.id || m.name || m.model || '')).filter(Boolean);
  }

  // If it has a .model array
  if (data.model && Array.isArray(data.model)) {
    return data.model.map((m: any) => typeof m === 'string' ? m : (m.id || m.name || m.model || '')).filter(Boolean);
  }
  
  return [];
}

export function registerProviderRoutes(server: FastifyInstance, ctx: AppContext) {
  // Safe provider metadata only (never exposes API keys).
  server.get("/api/providers", async () => {
    ctx.registry.reload();
    return ctx.registry.getSafeMetadata();
  });

  // Test a provider/model with a one-off completion request.
  server.post("/api/providers/test", async (request, reply) => {
    const { providerId, model, prompt } = request.body as {
      providerId: string;
      model: string;
      prompt: string;
    };

    if (!providerId || !model || !prompt) {
      reply.status(400);
      return { error: "Missing required fields: providerId, model, prompt" };
    }

    try {
      const provider = ctx.registry.getProvider(providerId);
      const result = await provider.complete({
        model,
        messages: [{ role: "user", content: prompt }]
      });
      return { success: true, content: result.content, usage: result.usage };
    } catch (error: any) {
      reply.status(500);
      return { success: false, error: error.message };
    }
  });

  // Get full configurations including API keys.
  server.get("/api/providers/config", async () => {
    ctx.registry.reload();
    return ctx.registry.getFullConfigs();
  });

  // Save new configurations.
  server.post("/api/providers/config", async (request, reply) => {
    const configs = request.body as Record<string, any>;
    if (!configs || typeof configs !== "object") {
      reply.status(400);
      return { error: "Invalid configuration object." };
    }
    try {
      ctx.registry.saveConfigs(configs);
      return { success: true };
    } catch (err: any) {
      reply.status(500);
      return { error: `Failed to save configuration: ${err.message}` };
    }
  });

  // Fetch available models from provider dynamically.
  server.post("/api/providers/fetch-models", async (request, reply) => {
    const { type, baseUrl, apiKey, providerId } = request.body as {
      type?: string;
      baseUrl?: string;
      apiKey?: string;
      providerId?: string;
    };

    let resolvedType = type;
    let resolvedBaseUrl = baseUrl;
    let resolvedApiKey = apiKey;

    if (providerId) {
      try {
        const fullConfigs = ctx.registry.getFullConfigs();
        const saved = fullConfigs[providerId];
        if (saved) {
          resolvedType = saved.type;
          resolvedBaseUrl = saved.baseUrl;
          resolvedApiKey = saved.apiKey;
        }
      } catch (e) {
        // ignore
      }
    }

    if (!resolvedType || !resolvedBaseUrl) {
      reply.status(400);
      return { error: "Missing required fields: type and baseUrl" };
    }

    const cleanBaseUrl = resolvedBaseUrl.replace(/\/$/, "");

    try {
      if (resolvedType === "openai-compatible") {
        const headers: Record<string, string> = {};
        if (resolvedApiKey) {
          headers["Authorization"] = `Bearer ${resolvedApiKey}`;
        }

        let response: Response | null = null;
        let lastError: Error | null = null;

        // Try /models first
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(`${cleanBaseUrl}/models`, {
            method: "GET",
            headers,
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            response = res;
          } else {
            const errText = await res.text().catch(() => "Unknown error");
            lastError = new Error(`Provider models API returned ${res.status}: ${errText}`);
          }
        } catch (err: any) {
          lastError = err;
        }

        // If it failed, try /model as a fallback
        if (!response) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const fallbackResponse = await fetch(`${cleanBaseUrl}/model`, {
              method: "GET",
              headers,
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (fallbackResponse.ok) {
              response = fallbackResponse;
            } else {
              const errText = await fallbackResponse.text().catch(() => "Unknown error");
              lastError = new Error(`Provider model API returned ${fallbackResponse.status}: ${errText}`);
            }
          } catch (err: any) {
            if (!lastError) lastError = err;
          }
        }

        if (!response || !response.ok) {
          throw new Error(lastError?.message || "Failed to fetch models from provider.");
        }

        const data = await response.json() as any;
        const models = parseModelsResponse(data);
        if (models.length === 0) {
          throw new Error("Could not parse models from provider response (format unrecognized)");
        }

        return { success: true, models };
      } else if (resolvedType === "anthropic") {
        const url = `${cleanBaseUrl}/v1/models`;
        const headers: Record<string, string> = {
          "anthropic-version": "2023-06-01"
        };
        if (resolvedApiKey) {
          headers["x-api-key"] = resolvedApiKey;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
          method: "GET",
          headers,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.warn(`Anthropic models API failed with status ${response.status}. Falling back to default list.`);
          return {
            success: true,
            models: [
              "claude-3-5-sonnet-20241022",
              "claude-3-5-sonnet-20240620",
              "claude-3-opus-20240229",
              "claude-3-sonnet-20240229",
              "claude-3-haiku-20240307",
              "claude-3-5-haiku-20241022"
            ]
          };
        }

        const data = await response.json() as any;
        if (data && Array.isArray(data.data)) {
          const models = data.data.map((m: any) => m.id);
          return { success: true, models };
        }

        throw new Error("Invalid models response format (expected data array)");
      } else {
        reply.status(400);
        return { error: `Unsupported provider type: ${resolvedType}` };
      }
    } catch (err: any) {
      reply.status(500);
      return { error: err.message };
    }
  });
}
