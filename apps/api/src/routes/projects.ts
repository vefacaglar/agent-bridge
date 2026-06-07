import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

const execAsync = promisify(exec);

export function registerProjectRoutes(server: FastifyInstance, ctx: AppContext) {
  // List all projects.
  server.get("/api/projects", async () => {
    return ctx.projectRepo.list();
  });

  // Create/add a project manually.
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

    await ctx.projectRepo.create(project);
    return project;
  });

  // Remove a project from the list (chat history is preserved).
  server.delete("/api/projects", async (request, reply) => {
    const { path: projectPath } = request.query as { path?: string };

    if (!projectPath) {
      reply.status(400);
      return { error: "Missing required query parameter: path" };
    }

    await ctx.projectRepo.delete(projectPath);
    return { success: true };
  });

  // Trigger the native macOS folder picker.
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
      if (error.message && (error.message.includes("User canceled") || error.message.includes("-128"))) {
        reply.status(400);
        return { error: "Selection cancelled by user." };
      }
      reply.status(500);
      return { error: `Failed to open folder picker: ${error.message}` };
    }
  });
}
