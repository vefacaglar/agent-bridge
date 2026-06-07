import Fastify from "fastify";
import cors from "@fastify/cors";
import { createAppContext } from "./context.js";
import { registerRoutes } from "./routes/index.js";

async function start() {
  const server = Fastify({ logger: true });

  await server.register(cors, {
    origin: "*" // allow all origins for local development
  });

  const ctx = createAppContext();
  registerRoutes(server, ctx);

  try {
    // The settings file (editable from the app's Settings screen) is the
    // source of truth for the port; PORT env is only a fallback default.
    const port = ctx.settingsStore.resolvePort();
    await server.listen({ port, host: "0.0.0.0" });
    console.log(`Server is running on http://localhost:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
