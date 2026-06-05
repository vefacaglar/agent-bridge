import Fastify from "fastify";
import cors from "@fastify/cors";

const server = Fastify({
  logger: true,
});

// Register CORS
await server.register(cors, {
  origin: "*", // allow all origins for development
});

// Basic ping/health endpoint
server.get("/ping", async (request, reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
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
