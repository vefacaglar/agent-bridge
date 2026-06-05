import Fastify from "fastify";
import cors from "@fastify/cors";
import type { RunStatus } from "@bridgemind/shared";
import { ProviderRegistry } from "./providers/ProviderRegistry.js";
import { RunRepository, MessageRepository } from "./database/repositories.js";
import { Orchestrator } from "./orchestrator/Orchestrator.js";
import { eventBus } from "./orchestrator/eventBus.js";

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
const orchestrator = new Orchestrator(runRepo, messageRepo, registry);

// Basic ping/health endpoint
server.get("/ping", async (request, reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Get safe provider metadata (no keys exposed)
server.get("/api/providers", async (request, reply) => {
  return registry.getSafeMetadata();
});

// Create and trigger a new orchestration run
server.post("/api/runs", async (request, reply) => {
  const { task, plannerProviderId, plannerModel, coderProviderId, coderModel, maxRounds: requestedMaxRounds } = request.body as {
    task: string;
    plannerProviderId: string;
    plannerModel: string;
    coderProviderId: string;
    coderModel: string;
    maxRounds?: number;
  };

  if (!task || !plannerProviderId || !plannerModel || !coderProviderId || !coderModel) {
    reply.status(400);
    return { error: "Missing required fields: task, plannerProviderId, plannerModel, coderProviderId, coderModel" };
  }

  const maxRoundsVal = requestedMaxRounds ?? 3;

  const plannerMeta = registry.getSafeMetadata().find(p => p.id === plannerProviderId);
  const coderMeta = registry.getSafeMetadata().find(p => p.id === coderProviderId);

  const plannerProviderDisplayName = plannerMeta ? plannerMeta.displayName : plannerProviderId;
  const coderProviderDisplayName = coderMeta ? coderMeta.displayName : coderProviderId;

  const runId = `run-${Date.now()}`;
  const title = task.length > 25 ? task.substring(0, 25) + "..." : task;

  const run = {
    id: runId,
    title,
    task,
    status: "created" as RunStatus,
    plannerProviderId,
    plannerProviderDisplayName,
    plannerModel,
    coderProviderId,
    coderProviderDisplayName,
    coderModel,
    maxRounds: maxRoundsVal,
    currentRound: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  runRepo.create(run);

  // Trigger orchestration asynchronously in the background
  orchestrator.run(runId).catch(err => {
    console.error(`[Orchestrator] Error running job ${runId}:`, err.message);
  });

  return run;
});

// Cancel a running orchestration job
server.post("/api/runs/:id/cancel", async (request, reply) => {
  const { id } = request.params as { id: string };
  const success = orchestrator.cancel(id);
  if (!success) {
    reply.status(400);
    return { error: `Run with id "${id}" is not actively running or cannot be cancelled` };
  }
  return { success: true };
});

// Duplicate a run with selectable planner/coder configuration
server.post("/api/runs/:id/duplicate", async (request, reply) => {
  const { id } = request.params as { id: string };
  const sourceRun = runRepo.getById(id);
  if (!sourceRun) {
    reply.status(404);
    return { error: `Source run with id "${id}" not found` };
  }

  const { plannerProviderId, plannerModel, coderProviderId, coderModel, maxRounds: requestedMaxRounds } = request.body as {
    plannerProviderId: string;
    plannerModel: string;
    coderProviderId: string;
    coderModel: string;
    maxRounds?: number;
  };

  if (!plannerProviderId || !plannerModel || !coderProviderId || !coderModel) {
    reply.status(400);
    return { error: "Missing required fields: plannerProviderId, plannerModel, coderProviderId, coderModel" };
  }

  const maxRoundsVal = requestedMaxRounds ?? sourceRun.maxRounds;

  const plannerMeta = registry.getSafeMetadata().find(p => p.id === plannerProviderId);
  const coderMeta = registry.getSafeMetadata().find(p => p.id === coderProviderId);

  const plannerProviderDisplayName = plannerMeta ? plannerMeta.displayName : plannerProviderId;
  const coderProviderDisplayName = coderMeta ? coderMeta.displayName : coderProviderId;

  const runId = `run-${Date.now()}`;

  const run = {
    id: runId,
    title: sourceRun.title,
    task: sourceRun.task,
    status: "created" as RunStatus,
    plannerProviderId,
    plannerProviderDisplayName,
    plannerModel,
    coderProviderId,
    coderProviderDisplayName,
    coderModel,
    maxRounds: maxRoundsVal,
    currentRound: 0,
    sourceRunId: id,
    retryType: "duplicate",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  runRepo.create(run);

  // Trigger asynchronously in the background
  orchestrator.run(runId).catch(err => {
    console.error(`[Orchestrator] Error running duplicated job ${runId}:`, err.message);
  });

  return run;
});

// Retry coder on the same task and planner plan, but with different coder model
server.post("/api/runs/:id/retry-coder", async (request, reply) => {
  const { id } = request.params as { id: string };
  const sourceRun = runRepo.getById(id);
  if (!sourceRun) {
    reply.status(404);
    return { error: `Source run with id "${id}" not found` };
  }

  const { coderProviderId, coderModel, maxRounds: requestedMaxRounds } = request.body as {
    coderProviderId: string;
    coderModel: string;
    maxRounds?: number;
  };

  if (!coderProviderId || !coderModel) {
    reply.status(400);
    return { error: "Missing required fields: coderProviderId, coderModel" };
  }

  const maxRoundsVal = requestedMaxRounds ?? sourceRun.maxRounds;

  const coderMeta = registry.getSafeMetadata().find(p => p.id === coderProviderId);
  const coderProviderDisplayName = coderMeta ? coderMeta.displayName : coderProviderId;

  const runId = `run-${Date.now()}`;

  const run = {
    id: runId,
    title: sourceRun.title,
    task: sourceRun.task,
    status: "created" as RunStatus,
    plannerProviderId: sourceRun.plannerProviderId,
    plannerProviderDisplayName: sourceRun.plannerProviderDisplayName,
    plannerModel: sourceRun.plannerModel,
    coderProviderId,
    coderProviderDisplayName,
    coderModel,
    maxRounds: maxRoundsVal,
    currentRound: 0,
    sourceRunId: id,
    retryType: "retry-coder",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  runRepo.create(run);

  // Trigger asynchronously in the background
  orchestrator.run(runId).catch(err => {
    console.error(`[Orchestrator] Error running coder-retried job ${runId}:`, err.message);
  });

  return run;
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

// SSE event streaming for a specific run
server.get("/api/runs/:id/events", async (request, reply) => {
  const { id } = request.params as { id: string };

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });

  // Write initial connection success event
  reply.raw.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const listener = (event: any) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);

    // Disconnect when run finishes
    if (
      event.type === "run_completed" ||
      event.type === "run_failed" ||
      (event.type === "status_changed" && (event.status === "done" || event.status === "failed" || event.status === "cancelled" || event.status === "max_rounds_reached"))
    ) {
      eventBus.off(`run:${id}`, listener);
      reply.raw.end();
    }
  };

  eventBus.on(`run:${id}`, listener);

  request.raw.on("close", () => {
    eventBus.off(`run:${id}`, listener);
  });
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
