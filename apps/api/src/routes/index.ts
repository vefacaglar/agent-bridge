import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { registerProviderRoutes } from "./providers.js";
import { registerProjectRoutes } from "./projects.js";
import { registerRunRoutes } from "./runs.js";

export function registerRoutes(server: FastifyInstance, ctx: AppContext) {
  server.get("/ping", async () => ({ status: "ok", timestamp: new Date().toISOString() }));

  registerProviderRoutes(server, ctx);
  registerProjectRoutes(server, ctx);
  registerRunRoutes(server, ctx);
}
