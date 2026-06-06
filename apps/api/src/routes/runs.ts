import type { FastifyInstance } from "fastify";
import type { Run, RunStatus } from "@agent-bridge/shared";
import { type AppContext, normalizeProject } from "../context.js";
import { eventBus } from "../orchestrator/eventBus.js";
import { permissionKey } from "../orchestrator/workspaceTools.js";

const PERMISSION_DECISIONS = ["allow_once", "allow_project", "allow_always", "deny"] as const;
type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

export function registerRunRoutes(server: FastifyInstance, ctx: AppContext) {
  // Create and trigger a new orchestration run.
  server.post("/api/runs", async (request, reply) => {
    const { task, projectPath, projectName, providerId, model, mode, coderProviderId, coderModel, utilityProviderId, utilityModel, agentPreset } = request.body as {
      task: string;
      projectPath?: string;
      projectName?: string;
      providerId: string;
      model: string;
      mode?: string;
      coderProviderId?: string;
      coderModel?: string;
      utilityProviderId?: string;
      utilityModel?: string;
      agentPreset?: string;
    };

    if (!task || !providerId || !model) {
      reply.status(400);
      return { error: "Missing required fields: task, providerId, model" };
    }

    const providerMeta = ctx.registry.getSafeMetadata().find(p => p.id === providerId);
    const providerDisplayName = providerMeta ? providerMeta.displayName : providerId;

    const runId = `run-${Date.now()}`;
    // Sessions start unnamed; the model renames them via the set_chat_title tool
    // once the user's intent is clear.
    const title = "New session…";
    const project = normalizeProject(ctx, projectPath, projectName);

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
      coderProviderId: coderProviderId || undefined,
      coderModel: coderModel || undefined,
      utilityProviderId: utilityProviderId || undefined,
      utilityModel: utilityModel || undefined,
      agentPreset: agentPreset || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    ctx.runRepo.create(run);

    // Run orchestration asynchronously in the background.
    ctx.orchestrator.run(runId).catch(err => {
      console.error(`[Orchestrator] Error running job ${runId}:`, err.message);
    });

    return run;
  });

  // Cancel a running orchestration job.
  server.post("/api/runs/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const success = ctx.orchestrator.cancel(id);
    if (!success) {
      const run = ctx.runRepo.getById(id);
      if (run) {
        return { success: true, message: "Run was not actively running." };
      }
      reply.status(404);
      return { error: `Run with id "${id}" not found` };
    }
    return { success: true };
  });

  // Continue a run with follow-up instructions in the same thread.
  server.post("/api/runs/:id/continue", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { task, providerId, model, mode, coderProviderId, coderModel, utilityProviderId, utilityModel, agentPreset } = request.body as {
      task: string;
      providerId?: string;
      model?: string;
      mode?: string;
      coderProviderId?: string;
      coderModel?: string;
      utilityProviderId?: string;
      utilityModel?: string;
      agentPreset?: string;
    };

    if (!task || !task.trim()) {
      reply.status(400);
      return { error: "Missing required field: task" };
    }

    const run = ctx.runRepo.getById(id);
    if (!run) {
      reply.status(404);
      return { error: `Run with id "${id}" not found` };
    }

    // Update model or mode if changed mid-conversation.
    const updates: Partial<Run> = {};
    if (providerId && model) {
      const providerMeta = ctx.registry.getSafeMetadata().find(p => p.id === providerId);
      updates.providerId = providerId;
      updates.providerDisplayName = providerMeta ? providerMeta.displayName : providerId;
      updates.model = model;
    }
    if (mode) {
      updates.mode = mode;
    }
    // Allow switching the agent preset (or back to single model) mid-conversation.
    // The web client always sends the current selection, so reflect it verbatim.
    const body = request.body as Record<string, unknown>;
    if ("agentPreset" in body || "coderModel" in body) {
      updates.agentPreset = agentPreset || undefined;
      updates.coderProviderId = coderProviderId || undefined;
      updates.coderModel = coderModel || undefined;
      updates.utilityProviderId = utilityProviderId || undefined;
      updates.utilityModel = utilityModel || undefined;
    }
    if (Object.keys(updates).length > 0) {
      ctx.runRepo.update(id, updates);
    }

    // Persist the user message and surface it immediately.
    const userMsg = {
      id: `msg-user-${Date.now()}`,
      runId: id,
      role: "user" as const,
      content: task,
      createdAt: new Date().toISOString()
    };
    ctx.messageRepo.create(userMsg);
    eventBus.emit(`run:${id}`, { type: "message_created", message: userMsg });

    ctx.runRepo.update(id, { status: "generating" });
    eventBus.emit(`run:${id}`, { type: "status_changed", status: "generating" });

    ctx.orchestrator.continueRun(id, task).catch(err => {
      console.error(`[Orchestrator] Error continuing job ${id}:`, err.message);
    });

    return { success: true };
  });

  // Resolve a pending permission request for a running job.
  server.post("/api/runs/:id/permission", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { decision } = request.body as { decision: PermissionDecision };

    if (!PERMISSION_DECISIONS.includes(decision)) {
      reply.status(400);
      return { error: `Invalid decision value. Must be one of: ${PERMISSION_DECISIONS.join(", ")}` };
    }

    const run = ctx.runRepo.getById(id);
    if (!run) {
      reply.status(404);
      return { error: `Run with id "${id}" not found` };
    }

    // Persist the grant scoped to the exact tool/command being approved, so it
    // never leaks to a different command or tool. run_command grants are keyed
    // to the exact command string.
    const pending = ctx.orchestrator.getPendingPermission(id);
    try {
      if (pending?.toolCall && (decision === "allow_project" || decision === "allow_always")) {
        const { tool, command } = permissionKey(pending.toolCall);
        if (decision === "allow_project" && run.projectPath) {
          ctx.permissionRepo.allowProject(run.projectPath, tool, command);
        } else if (decision === "allow_always") {
          ctx.permissionRepo.allowGlobal(tool, command);
        }
      }
    } catch (err: any) {
      console.error("[Server] Error saving permission:", err.message);
    }

    const resolved = ctx.orchestrator.resolvePermission(id, decision);
    if (!resolved) {
      reply.status(400);
      return { error: "No pending permission request found for this run" };
    }

    return { success: true };
  });

  // Run history list.
  server.get("/api/runs", async () => {
    return ctx.runRepo.list();
  });

  // Single run details.
  server.get("/api/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = ctx.runRepo.getById(id);
    if (!run) {
      reply.status(404);
      return { error: `Run with id "${id}" not found` };
    }
    return run;
  });

  // Messages for a single run.
  server.get("/api/runs/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = ctx.runRepo.getById(id);
    if (!run) {
      reply.status(404);
      return { error: `Run with id "${id}" not found` };
    }
    return ctx.messageRepo.listByRunId(id);
  });

  // Active plan for a single run (drives the plan side panel). Returns null
  // when the run has no plan yet.
  server.get("/api/runs/:id/plan", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = ctx.runRepo.getById(id);
    if (!run) {
      reply.status(404);
      return { error: `Run with id "${id}" not found` };
    }
    return ctx.planRepo.getActive(id);
  });

  // SSE event stream for a specific run.
  server.get("/api/runs/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    reply.raw.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    const run = ctx.runRepo.getById(id);
    if (!run) {
      reply.raw.write(`data: ${JSON.stringify({ type: "run_failed", errorMessage: "Run not found." })}\n\n`);
      reply.raw.end();
      return;
    }

    // If the run is already in a final state, immediately notify client and close the stream.
    if (run.status === "done" || run.status === "failed" || run.status === "cancelled") {
      if (run.status === "failed") {
        reply.raw.write(`data: ${JSON.stringify({ type: "run_failed", errorMessage: run.errorMessage })}\n\n`);
      } else if (run.status === "done") {
        reply.raw.write(`data: ${JSON.stringify({ type: "run_completed", finalOutput: "" })}\n\n`);
      } else {
        reply.raw.write(`data: ${JSON.stringify({ type: "status_changed", status: run.status })}\n\n`);
      }
      reply.raw.end();
      return;
    }

    const listener = (event: any) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);

      const finished =
        event.type === "run_completed" ||
        event.type === "run_failed" ||
        (event.type === "status_changed" &&
          (event.status === "done" || event.status === "failed" || event.status === "cancelled"));

      if (finished) {
        eventBus.off(`run:${id}`, listener);
        reply.raw.end();
      }
    };

    eventBus.on(`run:${id}`, listener);

    request.raw.on("close", () => {
      eventBus.off(`run:${id}`, listener);
    });
  });
}
