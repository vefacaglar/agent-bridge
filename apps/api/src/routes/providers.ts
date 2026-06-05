import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

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
}
