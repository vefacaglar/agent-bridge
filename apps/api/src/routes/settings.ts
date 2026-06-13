import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { AppSettingsStore, SEARCH_PRESERVE_API_KEY_VALUE } from "../config/AppSettingsStore.js";

export function registerSettingsRoutes(server: FastifyInstance, ctx: AppContext) {
  // Current local app settings (port + search config).
  server.get("/api/settings", async () => {
    return ctx.settingsStore.read();
  });

  // Update app settings. Changing the port takes effect on the next backend
  // start (the Electron main process restarts the server); the response flags
  // that a restart is required so the UI can tell the user.
  server.put("/api/settings", async (request, reply) => {
    const body = (request.body ?? {}) as { port?: unknown; search?: Record<string, unknown> };
    const port = AppSettingsStore.normalizePort(body.port);
    if (!port) {
      reply.status(400);
      return { error: "Invalid port. Use an integer between 1 and 65535." };
    }

    const current = ctx.settingsStore.read();
    const search = body.search
      ? {
          engine: String(body.search.engine ?? current.search?.engine ?? "duckduckgo") as any,
          braveApiKey: typeof body.search.braveApiKey === "string" ? body.search.braveApiKey : SEARCH_PRESERVE_API_KEY_VALUE,
          googleApiKey: typeof body.search.googleApiKey === "string" ? body.search.googleApiKey : SEARCH_PRESERVE_API_KEY_VALUE,
          googleSearchEngineId: typeof body.search.googleSearchEngineId === "string" ? body.search.googleSearchEngineId : current.search?.googleSearchEngineId
        }
      : current.search;

    const saved = ctx.settingsStore.save({ port, search });
    return { ...saved, restartRequired: true };
  });
}
