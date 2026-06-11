import path from "node:path";
import { exec } from "node:child_process";
import type { Run, ToolCall } from "@locagens/shared";
import { truncateOutput } from "./pathGuards.js";
import { commandScansOutsideWorkspace } from "./permissionPreview.js";
import { executeWorkspaceTool } from "./fileToolExecutor.js";

/**
 * The async tools (shell + network) and the orchestrator's execution entry
 * point. run_command / fetch_url / search_web are inherently asynchronous, so
 * the orchestrator always executes tools through executeWorkspaceToolAsync;
 * synchronous filesystem tools fall through to executeWorkspaceTool.
 */

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
        return await searchWeb(
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

async function searchWeb(rawQuery: string, rawMaxResults?: number): Promise<string> {
  const query = rawQuery.trim();
  if (query === "") {
    return JSON.stringify({ success: false, error: "Missing parameter: query" });
  }
  const maxResults = Math.min(Math.max(Math.floor(rawMaxResults ?? 5), 1), 10);
  const searchUrl = `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query }).toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(searchUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Locagens/1.0 (+local workspace assistant)" }
    });
    const body = await response.text();
    const results = parseDuckDuckGoResults(body).slice(0, maxResults);
    return JSON.stringify({
      success: response.ok,
      status: response.status,
      query,
      source: "duckduckgo_html",
      results
    });
  } catch (err: any) {
    const aborted = err?.name === "AbortError";
    return JSON.stringify({ success: false, error: aborted ? "Search timed out after 30s." : (err?.message ?? "Search failed.") });
  } finally {
    clearTimeout(timeout);
  }
}

function parseDuckDuckGoResults(html: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blocks = html.match(/<div class="result[\s\S]*?(?=<div class="result|<\/body>)/g) ?? [];
  for (const block of blocks) {
    const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;
    const url = normalizeSearchResultUrl(decodeHtml(linkMatch[1]));
    const title = stripHtml(linkMatch[2]);
    if (!url || !title) continue;
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    results.push({
      title,
      url,
      snippet: stripHtml(snippetMatch?.[1] ?? snippetMatch?.[2] ?? "")
    });
  }
  return results;
}

function normalizeSearchResultUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, "https://duckduckgo.com");
    const redirected = parsed.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : parsed.toString();
  } catch {
    return rawUrl;
  }
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
