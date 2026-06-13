import path from "node:path";
import { exec } from "node:child_process";
import type { Run, ToolCall } from "@locagens/shared";
import { truncateOutput } from "./pathGuards.js";
import { commandScansOutsideWorkspace } from "./permissionPreview.js";
import { executeWorkspaceTool } from "./fileToolExecutor.js";
import type { ResolvedSearchSettings } from "../../search/SearchConfig.js";
import { SearchService } from "../../search/SearchService.js";
import type { ProviderSecretStore } from "../../providers/ProviderSecretStore.js";

/**
 * The async tools (shell + network) and the orchestrator's execution entry
 * point. run_command / fetch_url / search_web are inherently asynchronous, so
 * the orchestrator always executes tools through executeWorkspaceToolAsync;
 * synchronous filesystem tools fall through to executeWorkspaceTool.
 */

let searchService: SearchService | null = null;

export function configureSearchService(settings: ResolvedSearchSettings, secretStore: ProviderSecretStore): void {
  searchService = new SearchService(settings, secretStore);
}

/**
 * Async variant of executeWorkspaceTool. Identical for synchronous tools, but
 * handles network tools by awaiting the HTTP request. The orchestrator should
 * call this so web fetches resolve.
 */
export async function executeWorkspaceToolAsync(run: Run, toolCall: ToolCall): Promise<string> {
  if (toolCall.function.name === "run_command") {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const baseDir = path.resolve(run.projectPath || process.cwd());
      return await runShellCommand(baseDir, typeof args.command === "string" ? args.command : "");
    } catch (err: any) {
      return JSON.stringify({ success: false, error: err.message });
    }
  }
  if (toolCall.function.name !== "fetch_url") {
    if (toolCall.function.name === "search_web") {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        return await executeSearchWeb(
          typeof args.query === "string" ? args.query : "",
          typeof args.max_results === "number" ? args.max_results : undefined
        );
      } catch (err: any) {
        return JSON.stringify({ success: false, error: err.message });
      }
    }
    return executeWorkspaceTool(run, toolCall);
  }
  try {
    const args = JSON.parse(toolCall.function.arguments);
    return await fetchUrl(typeof args.url === "string" ? args.url : "");
  } catch (err: any) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

async function executeSearchWeb(query: string, maxResults?: number): Promise<string> {
  if (!searchService) {
    return JSON.stringify({ success: false, error: "Search service is not configured." });
  }
  const response = await searchService.search(query, maxResults);
  return JSON.stringify(response);
}

/** Runs shell commands without blocking the orchestrator's event loop. */
function runShellCommand(baseDir: string, rawCommand: string): Promise<string> {
  const command = rawCommand.trim();
  if (command === "") {
    return Promise.resolve(JSON.stringify({ success: false, error: "Missing parameter: command" }));
  }
  if (commandScansOutsideWorkspace(command)) {
    return Promise.resolve(JSON.stringify({
      success: false,
      error: "Refusing to scan outside the workspace. Search project-relative paths, or check installed tools with direct version/path commands."
    }));
  }

  return new Promise((resolve) => {
    exec(command, {
      cwd: baseDir,
      encoding: "utf-8",
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024
    }, (cmdErr, stdout, stderr) => {
      if (!cmdErr) {
        resolve(JSON.stringify({
          success: true,
          exitCode: 0,
          stdout: truncateOutput(stdout?.toString?.() ?? ""),
          stderr: truncateOutput(stderr?.toString?.() ?? "")
        }));
        return;
      }

      resolve(JSON.stringify({
        success: false,
        exitCode: typeof cmdErr.code === "number" ? cmdErr.code : null,
        stdout: truncateOutput(stdout?.toString?.() ?? ""),
        stderr: truncateOutput(stderr?.toString?.() ?? cmdErr.message ?? ""),
        error: cmdErr.signal === "SIGTERM" ? "Command timed out after 120s." : undefined
      }));
    });
  });
}

/** Fetches an http(s) URL and returns its text body (truncated). */
async function fetchUrl(rawUrl: string): Promise<string> {
  const url = rawUrl.trim();
  if (url === "") {
    return JSON.stringify({ success: false, error: "Missing parameter: url" });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return JSON.stringify({ success: false, error: `Invalid URL: ${url}` });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return JSON.stringify({ success: false, error: "Only http and https URLs are allowed." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Locagens/1.0 (+local workspace assistant)" }
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    return JSON.stringify({
      success: response.ok,
      status: response.status,
      contentType,
      finalUrl: response.url,
      content: truncateOutput(body)
    });
  } catch (err: any) {
    const aborted = err?.name === "AbortError";
    return JSON.stringify({ success: false, error: aborted ? "Request timed out after 30s." : (err?.message ?? "Fetch failed.") });
  } finally {
    clearTimeout(timeout);
  }
}
