import type { FastifyInstance } from "fastify";
import type { AppSettings, SearchSettings } from "@locagens/shared";
import type { AppContext } from "../context.js";
import { AppSettingsStore, SEARCH_PRESERVE_API_KEY_VALUE } from "../config/AppSettingsStore.js";

interface SettingsUpdateBody {
  port?: unknown;
  search?: Partial<SearchSettings>;
}

export function registerSettingsRoutes(server: FastifyInstance, ctx: AppContext) {
  // Current local app settings (port + search config).
  server.get("/api/settings", async () => {
    return ctx.settingsStore.read();
  });

  // Update app settings. Changing the port takes effect on the next backend
  // start (the Electron main process restarts the server); the response flags
  // that a restart is required so the UI can tell the user.
  server.put("/api/settings", async (request, reply) => {
    const body = (request.body ?? {}) as SettingsUpdateBody;
    const port = AppSettingsStore.normalizePort(body.port);
    if (!port) {
      reply.status(400);
      return { error: "Invalid port. Use an integer between 1 and 65535." };
    }

    const current = ctx.settingsStore.read();
    const search = buildSearchSettings(body.search, current.search);

    const saved = ctx.settingsStore.save({ port, search });
    return { ...saved, restartRequired: true };
  });
}

function buildSearchSettings(input: Partial<SearchSettings> | undefined, current: SearchSettings | undefined): SearchSettings | undefined {
  if (!input) return current;

  return {
    engine: input.engine ?? current?.engine ?? "duckduckgo",
    braveApiKey: typeof input.braveApiKey === "string" ? input.braveApiKey : SEARCH_PRESERVE_API_KEY_VALUE,
    googleApiKey: typeof input.googleApiKey === "string" ? input.googleApiKey : SEARCH_PRESERVE_API_KEY_VALUE,
    googleSearchEngineId: typeof input.googleSearchEngineId === "string" ? input.googleSearchEngineId : current?.googleSearchEngineId,
    hasBraveApiKey: input.hasBraveApiKey ?? current?.hasBraveApiKey,
    hasGoogleApiKey: input.hasGoogleApiKey ?? current?.hasGoogleApiKey
  };
}
