import Fastify from "fastify";
import cors from "@fastify/cors";
import { ProviderRegistry } from "./providers/ProviderRegistry.js";
import { RunRepository, MessageRepository } from "./database/repositories.js";

const server = Fastify({
  logger: true,
});

// Register CORS
await server.register(cors, {
  origin: "*", // allow all origins for development
});

const registry = new ProviderRegistry();
const runRepo = new RunRepository();
const messageRepo = new MessageRepository();

// Basic ping/health endpoint
server.get("/ping", async (request, reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Get safe provider metadata (no keys exposed)
server.get("/api/providers", async (request, reply) => {
  return registry.getSafeMetadata();
});

// Get run history list
server.get("/api/runs", async (request, reply) => {
  return runRepo.list();
});

// Get single run details
server.get("/api/runs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const run = runRepo.getById(id);
  if (!run) {
    reply.status(404);
    return { error: `Run with id "${id}" not found` };
  }
  return run;
});

// Get messages for a single run
server.get("/api/runs/:id/messages", async (request, reply) => {
  const { id } = request.params as { id: string };
  const run = runRepo.getById(id);
  if (!run) {
    reply.status(404);
    return { error: `Run with id "${id}" not found` };
  }
  return messageRepo.listByRunId(id);
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
