import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { Run, ToolCall, PermissionPreview } from "@agent-bridge/shared";

/**
 * Tool schemas advertised to the model. The orchestrator is the only place
 * that knows how to execute these; providers just forward the definitions.
 */
export const WORKSPACE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Writes or overwrites content to a specified file in the local workspace directory. Use edit_file for small changes to large existing files.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path relative to the workspace directory (e.g., 'src/main.js' or 'index.html')."
          },
          content: {
            type: "string",
            description: "The exact text content to write to the file."
          }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description: "Edits an existing file by replacing an exact substring with new text. Prefer this over write_file when changing part of a larger file. The old_string must match the file content exactly (including whitespace and indentation).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path relative to the workspace directory."
          },
          old_string: {
            type: "string",
            description: "The exact text to find and replace. Must be unique in the file unless replace_all is true."
          },
          new_string: {
            type: "string",
            description: "The text to replace old_string with."
          },
          replace_all: {
            type: "boolean",
            description: "When true, replaces every occurrence of old_string. Defaults to false (replaces a single, unique occurrence)."
          }
        },
        required: ["path", "old_string", "new_string"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "delete_file",
      description: "Deletes a specified file from the local workspace directory.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path relative to the workspace directory."
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Reads the content of a specified file in the local workspace directory.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The file path relative to the workspace directory."
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "list_directory",
      description: "Lists all files and folders in a specified directory path (relative to the workspace). Use empty string '' or '.' for the root directory.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The directory path relative to the workspace (e.g., 'src' or '')."
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "create_directory",
      description: "Creates a new directory (and any missing parent directories) inside the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The directory path relative to the workspace (e.g., 'src/components')."
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "move_file",
      description: "Moves or renames a file or directory within the workspace. Both source and destination must stay inside the workspace.",
      parameters: {
        type: "object",
        properties: {
          source_path: {
            type: "string",
            description: "The current path of the file or directory, relative to the workspace."
          },
          destination_path: {
            type: "string",
            description: "The new path, relative to the workspace."
          }
        },
        required: ["source_path", "destination_path"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "search_files",
      description: "Searches the workspace for files whose name or content matches a query. Skips node_modules and .git. Returns matching files with line numbers for content hits.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The text to search for in file names and file contents."
          },
          path: {
            type: "string",
            description: "Optional subdirectory to limit the search to (relative to the workspace). Defaults to the whole workspace."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "run_command",
      description: "Runs a shell command in the workspace directory (e.g., to build, compile, run tests, or install dependencies). The command runs with the workspace as the working directory. This always requires explicit user permission before it runs.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute (e.g., 'npm run build' or 'pnpm test')."
          }
        },
        required: ["command"]
      }
    }
  }
];

/** Tools that must always be gated behind an explicit permission prompt. */
export const DANGEROUS_TOOLS = new Set(["run_command"]);

/**
 * The key a standing permission grant is scoped to. For run_command the grant
 * is per exact command string, so approving "dotnet build" does not approve
 * "dotnet build -f". Other tools are scoped per tool name (command is empty).
 */
export function permissionKey(toolCall: ToolCall): { tool: string; command: string } {
  const tool = toolCall.function.name;
  if (tool === "run_command") {
    let command = "";
    try {
      command = String(JSON.parse(toolCall.function.arguments || "{}").command ?? "").trim();
    } catch {
      command = "";
    }
    return { tool, command };
  }
  return { tool, command: "" };
}

/** Resolves a workspace-relative path to an absolute one, refusing to escape. */
function resolveInside(baseDir: string, relativePath: string): string {
  const absolutePath = path.resolve(baseDir, relativePath);
  const isInside = absolutePath === baseDir || absolutePath.startsWith(baseDir + path.sep);
  if (!isInside) {
    throw new Error(`Access denied: path '${relativePath}' is outside of the workspace directory.`);
  }
  return absolutePath;
}

/** Reads a file's current content, or null if it is missing/unreadable. */
function readExistingFile(absolutePath: string): string | null {
  try {
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      return fs.readFileSync(absolutePath, "utf-8");
    }
  } catch {
    /* ignore unreadable files */
  }
  return null;
}

/**
 * Builds the preview shown in the permission card before a tool runs.
 * For file writes/edits it computes the resulting content so the UI can render
 * a diff; for create/read/list it carries the path; run_command carries the
 * command; move_file carries source + destination.
 */
export function buildPermissionPreview(run: Run, toolCall: ToolCall): PermissionPreview | null {
  let args: any = {};
  try {
    args = JSON.parse(toolCall.function.arguments || "{}");
  } catch {
    args = {};
  }

  const baseDir = path.resolve(run.projectPath || process.cwd());
  const safeResolve = (rel: string): string => {
    try {
      return resolveInside(baseDir, rel);
    } catch {
      return path.resolve(baseDir, rel);
    }
  };

  const relativePath = typeof args.path === "string" ? args.path : "";
  const absolutePath = safeResolve(relativePath);

  switch (toolCall.function.name) {
    case "write_file": {
      const oldContent = readExistingFile(absolutePath);
      return {
        tool: "write_file",
        action: oldContent === null ? "create" : "edit",
        path: relativePath,
        absolutePath,
        oldContent,
        newContent: typeof args.content === "string" ? args.content : ""
      };
    }
    case "edit_file": {
      const oldContent = readExistingFile(absolutePath);
      const newContent = oldContent === null
        ? null
        : applyEdit(oldContent, args.old_string ?? "", args.new_string ?? "", !!args.replace_all);
      return {
        tool: "edit_file",
        action: "edit",
        path: relativePath,
        absolutePath,
        oldContent,
        newContent
      };
    }
    case "delete_file":
      return { tool: "delete_file", action: "delete", path: relativePath, absolutePath, oldContent: readExistingFile(absolutePath), newContent: null };
    case "read_file":
      return { tool: "read_file", action: "read", path: relativePath, absolutePath, oldContent: null, newContent: null };
    case "list_directory":
      return { tool: "list_directory", action: "list", path: relativePath, absolutePath, oldContent: null, newContent: null };
    case "create_directory":
      return { tool: "create_directory", action: "mkdir", path: relativePath, absolutePath, oldContent: null, newContent: null };
    case "move_file": {
      const source = typeof args.source_path === "string" ? args.source_path : "";
      const destination = typeof args.destination_path === "string" ? args.destination_path : "";
      return {
        tool: "move_file",
        action: "move",
        path: source,
        absolutePath: safeResolve(source),
        oldContent: null,
        newContent: null,
        destPath: destination
      };
    }
    case "search_files":
      return {
        tool: "search_files",
        action: "search",
        path: typeof args.path === "string" ? args.path : "",
        absolutePath,
        oldContent: null,
        newContent: null,
        query: typeof args.query === "string" ? args.query : ""
      };
    case "run_command":
      return {
        tool: "run_command",
        action: "command",
        path: "",
        absolutePath: baseDir,
        oldContent: null,
        newContent: null,
        command: typeof args.command === "string" ? args.command : ""
      };
    default:
      return null;
  }
}

/** Applies an exact-substring edit, validating uniqueness unless replace_all. */
function applyEdit(content: string, oldString: string, newString: string, replaceAll: boolean): string {
  if (oldString === "") {
    throw new Error("Missing parameter: old_string must not be empty.");
  }
  const occurrences = content.split(oldString).length - 1;
  if (occurrences === 0) {
    throw new Error("old_string was not found in the file.");
  }
  if (occurrences > 1 && !replaceAll) {
    throw new Error(`old_string is not unique (found ${occurrences} times). Provide more surrounding context or set replace_all to true.`);
  }
  return replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
}

/** Recursively collects files matching the query by name or content. */
function searchWorkspace(rootDir: string, baseDir: string, query: string): Array<{ path: string; line?: number; preview?: string }> {
  const results: Array<{ path: string; line?: number; preview?: string }> = [];
  const lowerQuery = query.toLowerCase();
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);
  const MAX_RESULTS = 100;

  const walk = (dir: string) => {
    if (results.length >= MAX_RESULTS) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) return;
      const absChild = path.join(dir, entry.name);
      const relChild = path.relative(baseDir, absChild);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(absChild);
      } else if (entry.isFile()) {
        if (entry.name.toLowerCase().includes(lowerQuery)) {
          results.push({ path: relChild });
          continue;
        }
        let content: string;
        try {
          const stat = fs.statSync(absChild);
          if (stat.size > 2_000_000) continue; // skip very large/binary files
          content = fs.readFileSync(absChild, "utf-8");
        } catch {
          continue;
        }
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(lowerQuery)) {
            results.push({ path: relChild, line: i + 1, preview: lines[i].trim().slice(0, 200) });
            break; // one hit per file is enough for an overview
          }
        }
      }
    }
  };

  walk(rootDir);
  return results;
}

/**
 * Executes a single workspace tool call against the run's project directory.
 * All file access is constrained to the workspace; any failure is returned as
 * a JSON error string rather than thrown, so the model can react to it.
 */
export function executeWorkspaceTool(run: Run, toolCall: ToolCall): string {
  try {
    const args = JSON.parse(toolCall.function.arguments);
    const baseDir = path.resolve(run.projectPath || process.cwd());

    switch (toolCall.function.name) {
      case "write_file": {
        const absolutePath = resolveInside(baseDir, requirePath(args.path));
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, args.content || "", "utf-8");
        return JSON.stringify({ success: true, message: `File written successfully at ${args.path}` });
      }
      case "edit_file": {
        const absolutePath = resolveInside(baseDir, requirePath(args.path));
        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
          return JSON.stringify({ success: false, error: `File not found at ${args.path}` });
        }
        const current = fs.readFileSync(absolutePath, "utf-8");
        const updated = applyEdit(current, args.old_string ?? "", args.new_string ?? "", !!args.replace_all);
        fs.writeFileSync(absolutePath, updated, "utf-8");
        return JSON.stringify({ success: true, message: `File edited successfully at ${args.path}` });
      }
      case "delete_file": {
        const absolutePath = resolveInside(baseDir, requirePath(args.path));
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
          return JSON.stringify({ success: true, message: `File deleted successfully at ${args.path}` });
        }
        return JSON.stringify({ success: false, message: `File not found at ${args.path}` });
      }
      case "read_file": {
        const absolutePath = resolveInside(baseDir, requirePath(args.path));
        if (!fs.existsSync(absolutePath)) {
          return JSON.stringify({ success: false, error: `File not found at ${args.path}` });
        }
        if (fs.statSync(absolutePath).isDirectory()) {
          throw new Error(`Path '${args.path}' is a directory, not a file. Use list_directory instead.`);
        }
        return JSON.stringify({ success: true, content: fs.readFileSync(absolutePath, "utf-8") });
      }
      case "list_directory": {
        const absolutePath = resolveInside(baseDir, requirePath(args.path));
        if (!fs.existsSync(absolutePath)) {
          return JSON.stringify({ success: false, error: `Directory not found at ${args.path}` });
        }
        if (!fs.statSync(absolutePath).isDirectory()) {
          throw new Error(`Path '${args.path}' is a file, not a directory. Use read_file instead.`);
        }
        const files = fs.readdirSync(absolutePath).map(file => {
          const fileStat = fs.statSync(path.join(absolutePath, file));
          return { name: file, isDirectory: fileStat.isDirectory(), size: fileStat.size };
        });
        return JSON.stringify({ success: true, files });
      }
      case "create_directory": {
        const absolutePath = resolveInside(baseDir, requirePath(args.path));
        fs.mkdirSync(absolutePath, { recursive: true });
        return JSON.stringify({ success: true, message: `Directory created at ${args.path}` });
      }
      case "move_file": {
        const sourceAbs = resolveInside(baseDir, requirePath(args.source_path, "source_path"));
        const destAbs = resolveInside(baseDir, requirePath(args.destination_path, "destination_path"));
        if (!fs.existsSync(sourceAbs)) {
          return JSON.stringify({ success: false, error: `Source not found at ${args.source_path}` });
        }
        fs.mkdirSync(path.dirname(destAbs), { recursive: true });
        fs.renameSync(sourceAbs, destAbs);
        return JSON.stringify({ success: true, message: `Moved ${args.source_path} to ${args.destination_path}` });
      }
      case "search_files": {
        const query = typeof args.query === "string" ? args.query : "";
        if (query === "") {
          throw new Error("Missing parameter: query");
        }
        const rootAbs = resolveInside(baseDir, typeof args.path === "string" ? args.path : "");
        if (!fs.existsSync(rootAbs)) {
          return JSON.stringify({ success: false, error: `Search path not found at ${args.path}` });
        }
        const matches = searchWorkspace(rootAbs, baseDir, query);
        return JSON.stringify({ success: true, matchCount: matches.length, matches });
      }
      case "run_command": {
        const command = typeof args.command === "string" ? args.command.trim() : "";
        if (command === "") {
          throw new Error("Missing parameter: command");
        }
        try {
          const stdout = execSync(command, {
            cwd: baseDir,
            encoding: "utf-8",
            timeout: 120_000,
            maxBuffer: 4 * 1024 * 1024,
            stdio: ["ignore", "pipe", "pipe"]
          });
          return JSON.stringify({ success: true, exitCode: 0, stdout: truncateOutput(stdout), stderr: "" });
        } catch (cmdErr: any) {
          return JSON.stringify({
            success: false,
            exitCode: typeof cmdErr.status === "number" ? cmdErr.status : null,
            stdout: truncateOutput(cmdErr.stdout?.toString?.() ?? ""),
            stderr: truncateOutput(cmdErr.stderr?.toString?.() ?? cmdErr.message ?? ""),
            error: cmdErr.signal === "SIGTERM" ? "Command timed out after 120s." : undefined
          });
        }
      }
      default:
        throw new Error(`Unknown function: ${toolCall.function.name}`);
    }
  } catch (err: any) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

/** Ensures a required path argument is present, returning it. */
function requirePath(value: unknown, name = "path"): string {
  if (value === undefined || value === null) {
    throw new Error(`Missing parameter: ${name}`);
  }
  return String(value);
}

/** Caps command output so a noisy build doesn't blow up the context window. */
function truncateOutput(output: string): string {
  const MAX = 20_000;
  if (output.length <= MAX) return output;
  return output.slice(0, MAX) + `\n... [output truncated, ${output.length - MAX} more characters]`;
}
