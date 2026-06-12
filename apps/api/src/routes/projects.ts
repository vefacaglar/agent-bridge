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

  // Check git status of a project.
  server.get("/api/projects/git/status", async (request, reply) => {
    const { path: projectPath } = request.query as { path?: string };
    if (!projectPath) {
      reply.status(400);
      return { error: "Missing required query parameter: path" };
    }

    try {
      // Check if git is initialized.
      await execAsync("git rev-parse --is-inside-work-tree", { cwd: projectPath });
      const { stdout: branch } = await execAsync("git branch --show-current", { cwd: projectPath });
      const { stdout: status } = await execAsync("git status --porcelain", { cwd: projectPath });
      
      return {
        isGit: true,
        branch: branch.trim(),
        hasChanges: status.trim().length > 0
      };
    } catch (error: any) {
      console.error("[Git Status Route Error]:", error);
      return { isGit: false };
    }
  });

  // Generate a commit message using the LLM model.
  server.post("/api/projects/git/generate-message", async (request, reply) => {
    const { runId } = request.body as { runId?: string };
    if (!runId) {
      reply.status(400);
      return { error: "Missing required body parameter: runId" };
    }

    const run = ctx.runRepo.getById(runId);
    if (!run) {
      reply.status(404);
      return { error: "Run not found" };
    }

    const projectPath = run.projectPath || ctx.defaultProjectPath;

    try {
      // Get the git diff.
      const { stdout: diff } = await execAsync("git diff HEAD", { cwd: projectPath });
      if (!diff.trim()) {
        // Fallback to checking if there are untracked files
        const { stdout: status } = await execAsync("git status --porcelain", { cwd: projectPath });
        if (!status.trim()) {
          return { message: "chore: update workspace" };
        }
      }

      // Truncate the diff if it is too large (e.g. limit to 12000 chars to avoid model context blow up)
      const maxDiffLen = 12000;
      const truncatedDiff = diff.length > maxDiffLen ? diff.slice(0, maxDiffLen) + "\n... [diff truncated] ..." : diff;

      const providerId = run.coderProviderId || run.providerId;
      const model = run.coderModel || run.model;

      const provider = ctx.registry.getProvider(providerId);
      const prompt = `Write a concise, professional Git commit message based on the following diff.
Use the conventional commits format (e.g., feat: ..., fix: ..., chore: ..., docs: ..., refactor: ..., style: ...).
The message should be short (50-72 characters for the subject line) and summarize the key changes. Do not include markdown formatting or backticks around the message. Just output the message itself.

Diff:
${truncatedDiff}`;

      const result = await provider.complete({
        model,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }]
      });

      // Clean up the output message
      let message = result.content.trim();
      // Remove any surrounding quotes or markdown ticks if returned
      message = message.replace(/^["'`\s]+|["'`\s]+$/g, "");
      
      return { message };
    } catch (error: any) {
      reply.status(500);
      return { error: `Failed to generate commit message: ${error.message}` };
    }
  });

  // Execute git commit or push action.
  server.post("/api/projects/git/commit", async (request, reply) => {
    const { path: projectPath, message, action } = request.body as {
      path?: string;
      message?: string;
      action?: "commit" | "commit-push" | "push";
    };

    if (!projectPath) {
      reply.status(400);
      return { error: "Missing required body parameter: path" };
    }

    if (!action || !["commit", "commit-push", "push"].includes(action)) {
      reply.status(400);
      return { error: "Invalid action. Must be 'commit', 'commit-push', or 'push'" };
    }

    if ((action === "commit" || action === "commit-push") && (!message || !message.trim())) {
      reply.status(400);
      return { error: "Missing required parameter: message" };
    }

    try {
      if (action === "commit" || action === "commit-push") {
        // Stage files
        await execAsync("git add .", { cwd: projectPath });
        // Commit
        // Escape quotes in commit message
        const escapedMsg = message!.replace(/"/g, '\\"');
        await execAsync(`git commit -m "${escapedMsg}"`, { cwd: projectPath });
      }

      if (action === "commit-push" || action === "push") {
        // Push
        await execAsync("git push", { cwd: projectPath });
      }

      return { success: true };
    } catch (error: any) {
      reply.status(500);
      return { error: error.message || "Failed to execute git action" };
    }
  });
}
