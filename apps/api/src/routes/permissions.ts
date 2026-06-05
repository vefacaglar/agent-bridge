import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export function registerPermissionRoutes(server: FastifyInstance, ctx: AppContext) {
  // List all standing permissions.
  server.get("/api/permissions", async () => {
    return ctx.permissionRepo.list();
  });

  // Revoke a single permission by id.
  server.delete("/api/permissions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    if (!Number.isInteger(numericId)) {
      reply.status(400);
      return { error: "Invalid permission id" };
    }

    const removed = ctx.permissionRepo.deleteById(numericId);
    if (!removed) {
      reply.status(404);
      return { error: `Permission with id "${id}" not found` };
    }
    return { success: true };
  });

  // Revoke all permissions.
  server.delete("/api/permissions", async () => {
    ctx.permissionRepo.clear();
    return { success: true };
  });
}
