import type { FastifyInstance } from "fastify";
import type { MemoryCategory, MemoryScope } from "@locagens/shared";
import type { AppContext } from "../context.js";

const CATEGORIES: MemoryCategory[] = ["user", "feedback", "project", "reference"];

export function registerMemoryRoutes(server: FastifyInstance, ctx: AppContext) {
  // List every saved memory (global + per-project) for the Settings view.
  server.get("/api/memories", async () => {
    return ctx.memoryRepo.list();
  });

  // Manually add a memory from the UI.
  server.post("/api/memories", async (request, reply) => {
    const body = request.body as {
      scope?: string;
      category?: string;
      content?: string;
      projectPath?: string;
    };
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      reply.status(400);
      return { error: "content is required" };
    }
    const scope: MemoryScope = body.scope === "global" ? "global" : "project";
    const category = (CATEGORIES.includes(body.category as MemoryCategory) ? body.category : "project") as MemoryCategory;
    if (scope === "project" && !body.projectPath?.trim()) {
      reply.status(400);
      return { error: "projectPath is required for a project-scoped memory" };
    }
    return await ctx.memoryRepo.create({
      scope,
      projectPath: scope === "project" ? body.projectPath!.trim() : "",
      category,
      content
    });
  });

  // Edit a memory's content.
  server.put("/api/memories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) {
      reply.status(400);
      return { error: "Invalid memory id" };
    }
    const body = request.body as { content?: string };
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      reply.status(400);
      return { error: "content is required" };
    }
    const updated = await ctx.memoryRepo.update(numericId, content);
    if (!updated) {
      reply.status(404);
      return { error: `Memory with id "${id}" not found` };
    }
    return updated;
  });

  // Delete a single memory.
  server.delete("/api/memories/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) {
      reply.status(400);
      return { error: "Invalid memory id" };
    }
    const removed = await ctx.memoryRepo.deleteById(numericId);
    if (!removed) {
      reply.status(404);
      return { error: `Memory with id "${id}" not found` };
    }
    return { success: true };
  });

  // Clear all memories.
  server.delete("/api/memories", async () => {
    await ctx.memoryRepo.clear();
    return { success: true };
  });
}
