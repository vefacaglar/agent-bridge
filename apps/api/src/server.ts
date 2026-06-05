import Fastify from "fastify";
import cors from "@fastify/cors";
import { ProviderRegistry } from "./providers/ProviderRegistry.js";

const server = Fastify({
  logger: true,
});

// Register CORS
await server.register(cors, {
  origin: "*", // allow all origins for development
});

const registry = new ProviderRegistry();

// Basic ping/health endpoint
server.get("/ping", async (request, reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Get safe provider metadata (no keys exposed)
server.get("/api/providers", async (request, reply) => {
  return registry.getSafeMetadata();
});

// Test completion request to check provider configuration
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
    const provider = registry.getProvider(providerId);
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

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await server.listen({ port, host: "0.0.0.0" });
    console.log(`Server is running on http://localhost:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
