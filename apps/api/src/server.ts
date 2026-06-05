import Fastify from "fastify";
import cors from "@fastify/cors";
import path from "node:path";
import type { RunStatus } from "@bridgemind/shared";
import { ProviderRegistry } from "./providers/ProviderRegistry.js";
import { RunRepository, MessageRepository, ProjectRepository } from "./database/repositories.js";
import { Orchestrator } from "./orchestrator/Orchestrator.js";
import { eventBus } from "./orchestrator/eventBus.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
import { db } from "./database/db.js";


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
const projectRepo = new ProjectRepository();
const orchestrator = new Orchestrator(runRepo, messageRepo, registry);


const defaultProjectPath = process.cwd();

function normalizeProject(projectPath?: string, projectName?: string) {
  const normalizedPath = projectPath?.trim() || defaultProjectPath;
  return {
    projectPath: normalizedPath,
    projectName: projectName?.trim() || path.basename(normalizedPath) || "Workspace"
  };
}

// Basic ping/health endpoint
server.get("/ping", async (request, reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Get safe provider metadata (no keys exposed)
server.get("/api/providers", async (request, reply) => {
  registry.reload();
  return registry.getSafeMetadata();
});

// GET /api/projects - list all projects
server.get("/api/projects", async (request, reply) => {
  return projectRepo.list();
});

// POST /api/projects - create/add a project manually
server.post("/api/projects", async (request, reply) => {
  const { path: projectPath, name: projectName } = request.body as {
    path?: string;
    name?: string;
  };

  if (!projectPath || !projectPath.trim()) {
    reply.status(400);
    return { error: "Missing required field: path" };
  }

  const resolvedPath = projectPath.trim();
  const resolvedName = projectName?.trim() || path.basename(resolvedPath) || "Workspace";

  const project = {
    path: resolvedPath,
    name: resolvedName,
    createdAt: new Date().toISOString()
  };

  projectRepo.create(project);
  return project;
});

// DELETE /api/projects - delete/remove a project
server.delete("/api/projects", async (request, reply) => {
  const { path: projectPath } = request.query as { path?: string };

  if (!projectPath) {
    reply.status(400);
    return { error: "Missing required query parameter: path" };
  }

  projectRepo.delete(projectPath);
  return { success: true };
});

// POST /api/projects/select-dir - trigger macOS native folder selection
server.post("/api/projects/select-dir", async (request, reply) => {
  if (process.platform !== "darwin") {
    reply.status(400);
    return { error: "Automatic folder picking is only supported on macOS. Please input the path manually." };
  }

  try {
    const { stdout } = await execAsync(
      `osascript -e 'POSIX path of (choose folder with prompt "Select a project folder:")'`
    );
    const selectedPath = stdout.trim();
    if (!selectedPath) {
      reply.status(400);
      return { error: "No folder selected" };
    }
    const folderName = path.basename(selectedPath) || "Workspace";
    return { path: selectedPath, name: folderName };
  } catch (error: any) {
    // Check if user cancelled
    if (error.message && (error.message.includes("User canceled") || error.message.includes("-128"))) {
      reply.status(400);
      return { error: "Selection cancelled by user." };
    }
    reply.status(500);
    return { error: `Failed to open folder picker: ${error.message}` };
  }
});


// Create and trigger a new orchestration run
server.post("/api/runs", async (request, reply) => {
  const { task, projectPath, projectName, providerId, model, mode } = request.body as {
    task: string;
    projectPath?: string;
    projectName?: string;
    providerId: string;
    model: string;
    mode?: string;
  };

  if (!task || !providerId || !model) {
    reply.status(400);
    return { error: "Missing required fields: task, providerId, model" };
  }

  const providerMeta = registry.getSafeMetadata().find(p => p.id === providerId);
  const providerDisplayName = providerMeta ? providerMeta.displayName : providerId;

  const runId = `run-${Date.now()}`;
  const title = task.length > 25 ? task.substring(0, 25) + "..." : task;
  const project = normalizeProject(projectPath, projectName);

  const run = {
    id: runId,
    title,
    task,
    ...project,
    status: "created" as RunStatus,
    providerId,
    providerDisplayName,
    model,
    mode: mode || "accept_edits",
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

// Continue a run with follow-up instructions in the same thread
server.post("/api/runs/:id/continue", async (request, reply) => {
  const { id } = request.params as { id: string };
  const { task, providerId, model, mode } = request.body as {
    task: string;
    providerId?: string;
    model?: string;
    mode?: string;
  };

  if (!task || !task.trim()) {
    reply.status(400);
    return { error: "Missing required field: task" };
  }

  const run = runRepo.getById(id);
  if (!run) {
    reply.status(404);
    return { error: `Run with id "${id}" not found` };
  }

  // Update model or mode if changed mid-conversation
  const updates: Partial<Run> = {};
  if (providerId && model) {
    const providerMeta = registry.getSafeMetadata().find(p => p.id === providerId);
    const providerDisplayName = providerMeta ? providerMeta.displayName : providerId;
    updates.providerId = providerId;
    updates.providerDisplayName = providerDisplayName;
    updates.model = model;
  }
  if (mode) {
    updates.mode = mode;
  }
  if (Object.keys(updates).length > 0) {
    runRepo.update(id, updates);
  }

  // Create the user message in the DB
  const userMsgId = `msg-user-${Date.now()}`;
  const userMsg = {
    id: userMsgId,
    runId: id,
    role: "user" as const,
    content: task,
    createdAt: new Date().toISOString()
  };
  messageRepo.create(userMsg);

  // Trigger event so frontend shows the user message immediately
  eventBus.emit(`run:${id}`, { type: "message_created", message: userMsg });

  // Update status to generating for the new turn
  runRepo.update(id, { status: "generating" });
  eventBus.emit(`run:${id}`, { type: "status_changed", status: "generating" });

  // Run the orchestration continuation in the background
  orchestrator.continueRun(id, task).catch(err => {
    console.error(`[Orchestrator] Error continuing job ${id}:`, err.message);
  });

  return { success: true };
});

// Resolve a pending permission request for a running job
server.post("/api/runs/:id/permission", async (request, reply) => {
  const { id } = request.params as { id: string };
  const { decision } = request.body as { decision: "allow_once" | "allow_project" | "allow_always" | "deny" };

  if (!["allow_once", "allow_project", "allow_always", "deny"].includes(decision)) {
    reply.status(400);
    return { error: "Invalid decision value. Must be one of: allow_once, allow_project, allow_always, deny" };
  }

  // Get run to save permissions to DB if needed
  const run = runRepo.getById(id);
  if (!run) {
    reply.status(404);
    return { error: `Run with id "${id}" not found` };
  }

  try {
    // Save permission if needed
    if (decision === "allow_project" && run.projectPath) {
      db.prepare(`
        INSERT OR REPLACE INTO permissions (scope, project_path, status)
        VALUES ('project', ?, 'allowed')
      `).run(run.projectPath);
    } else if (decision === "allow_always") {
      db.prepare(`
        INSERT OR REPLACE INTO permissions (scope, project_path, status)
        VALUES ('global', '', 'allowed')
      `).run();
    }
  } catch (err: any) {
    console.error("[Server] Error saving permission:", err.message);
  }

  // Resolve permission in Orchestrator
  const resolved = orchestrator.resolvePermission(id, decision);
  if (!resolved) {
    reply.status(400);
    return { error: "No pending permission request found for this run" };
  }

  return { success: true };
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
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
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
