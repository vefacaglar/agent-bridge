import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { AppSettingsStore } from "../config/AppSettingsStore.js";

export function registerSettingsRoutes(server: FastifyInstance, ctx: AppContext) {
  // Current local app settings (currently just the backend port).
  server.get("/api/settings", async () => {
    return ctx.settingsStore.read();
  });

  // Update app settings. Changing the port takes effect on the next backend
  // start (the Electron main process restarts the server); the response flags
  // that a restart is required so the UI can tell the user.
  server.put("/api/settings", async (request, reply) => {
    const body = (request.body ?? {}) as { port?: unknown };
    const port = AppSettingsStore.normalizePort(body.port);
    if (!port) {
      reply.status(400);
      return { error: "Invalid port. Use an integer between 1 and 65535." };
    }

    const saved = ctx.settingsStore.save({ port });
    return { ...saved, restartRequired: true };
  });
}
