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
  },
  {
    type: "function" as const,
    function: {
      name: "fetch_url",
      description: "Fetches a web page or API endpoint over HTTP(S) and returns its text content (HTML, JSON, or plain text). Use this to look up documentation, read an API response, or check a reference online. Only http and https URLs are allowed. This always requires explicit user permission before it runs.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The absolute http(s) URL to fetch (e.g., 'https://example.com/docs')."
          }
        },
        required: ["url"]
      }
    }
  }
];

/**
 * Plan-mode-only tool. Lets the model create and maintain a structured,
 * chat-specific plan (title + ordered steps with status). The orchestrator
 * persists it to SQLite and pushes it to the plan panel; it never touches the
 * filesystem, so it runs without a permission prompt.
 */
export const UPDATE_PLAN_TOOL = {
  type: "function" as const,
  function: {
    name: "update_plan",
    description: "Record the plan for this chat as a STABLE document shown to the user in a side panel. Put the COMPLETE plan write-up in the body field and the list of steps in tasks — this tool's output IS the plan the user reads, so do not also paste the full plan into your chat reply. Call it once when you first draft the plan. Do NOT call it again to show progress; the panel is meant to stay unchanged. Only call it again when the user explicitly asks you to revise/change the plan (update the same plan), or — when an entirely finished plan is replaced by a genuinely new effort — with start_new set to true.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "A short title summarizing what this plan accomplishes."
        },
        body: {
          type: "string",
          description: "The full plan write-up in markdown, rendered above the checklist in the panel. Include everything the user should read: overview/goal, key design decisions (tables are fine), a file-by-file breakdown, and any notes. This is the primary place the detailed plan lives, so be thorough here rather than in the chat message."
        },
        tasks: {
          type: "array",
          description: "The complete ordered list of plan steps with their current status.",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "The step description." },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Current status of this step."
              }
            },
            required: ["text", "status"]
          }
        },
        start_new: {
          type: "boolean",
          description: "Set true to supersede the previous (finished) plan with a brand-new one. Omit or false to update the current plan in place."
        }
      },
      required: ["title", "tasks"]
    }
  }
};

/**
 * Lets the model name the chat session. Available in every mode; performs no
 * filesystem/network I/O (it only renames the run), so it runs silently without
 * a permission prompt. The orchestrator persists the title and broadcasts it.
 */
export const SET_TITLE_TOOL = {
  type: "function" as const,
  function: {
    name: "set_chat_title",
    description: "Set a short, descriptive title for THIS chat session (3-6 words, no quotes, in the user's language). Call this exactly once, as soon as the user's intent is clear (typically right after their first message). The session starts as \"New session…\"; replace it with a concise title that summarizes the task. Do not call it again unless the topic of the conversation fundamentally changes.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "A short, descriptive title for the session (3-6 words, no surrounding quotes)."
        }
      },
      required: ["title"]
    }
  }
};

/**
 * Lets the main agent ask the user one or more multiple-choice questions when it
 * needs a decision only the user can make. Performs no filesystem/network I/O —
 * the orchestrator pauses the run, surfaces the questions to the UI, and feeds
 * the chosen answers back as the tool result. Available to the main agent in
 * every mode; sub-agents never get it.
 */
export const ASK_QUESTION_TOOL = {
  type: "function" as const,
  function: {
    name: "ask_user_question",
    description: "Ask the user one or more multiple-choice questions when you are blocked on a decision that is genuinely theirs to make — one you cannot resolve from the request, the code, or sensible defaults. Do NOT use it for choices with an obvious default or facts you can verify yourself; in those cases pick the obvious option and proceed. The run pauses until the user answers, and you receive their selections back. Keep questions short and the options concrete and mutually exclusive (unless multiSelect is set). Ask 1-4 questions, each with 2-4 options.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "The questions to ask (1-4).",
          items: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "The full question text, clear and specific, ending with a question mark."
              },
              header: {
                type: "string",
                description: "A very short label for the question (max 12 chars), e.g. \"Auth method\", \"Library\"."
              },
              multiSelect: {
                type: "boolean",
                description: "True to let the user pick more than one option; false for a single choice."
              },
              options: {
                type: "array",
                description: "The available choices (2-4). Each must be a distinct option.",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "The choice text shown to the user (concise)." },
                    description: { type: "string", description: "Optional one-line explanation of what this choice means." }
                  },
                  required: ["label"]
                }
              }
            },
            required: ["question", "header", "options"]
          }
        }
      },
      required: ["questions"]
    }
  }
};

/**
 * Lets the main agent persist a durable fact across sessions. Performs no
 * filesystem/network I/O (it only writes a row to the memory table), so it is
 * not in DANGEROUS_TOOLS and runs silently without a permission prompt. Memories
 * are injected back into future runs' system prompt. Available to the main agent
 * in every mode; sub-agents never get it.
 */
export const REMEMBER_TOOL = {
  type: "function" as const,
  function: {
    name: "remember",
    description: "Save a DURABLE fact to remember across future sessions. Use this when you learn something that will stay useful beyond the current task: a user preference or working style, recurring feedback the user gives you about HOW to work, a stable fact about this project, or a reference (URL/ticket) worth keeping. Do NOT remember transient task details, one-off context, secrets, or anything already written in the code/config. Keep each memory to 1-3 sentences. Saving is silent (no confirmation); the user manages saved memories in Settings. If you are refining a memory that already exists (shown to you in 'Remembered context'), pass its id as update_id instead of creating a duplicate.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["global", "project"],
          description: "\"global\" for facts about the user or their general working style that apply to ALL projects; \"project\" for facts specific to THIS codebase."
        },
        category: {
          type: "string",
          enum: ["user", "feedback", "project", "reference"],
          description: "user = who the user is / general preferences; feedback = guidance on how you should work; project = a fact about this codebase; reference = an external pointer (URL, ticket)."
        },
        content: {
          type: "string",
          description: "The fact to remember, in 1-3 concise sentences."
        },
        update_id: {
          type: "number",
          description: "Optional: the id of an existing memory (from 'Remembered context') to revise in place instead of creating a new one."
        }
      },
      required: ["scope", "category", "content"]
    }
  }
};

/**
 * Architect-only tool (dual-model runs). Lets the architect model delegate one
 * or more self-contained coding tasks to coder sub-agents running the configured
 * coder model. Performs no direct filesystem/network I/O itself — the orchestrator
 * runs each sub-agent loop — so it is not in DANGEROUS_TOOLS and runs without a
 * permission prompt (the sub-agents' own tool calls are still gated normally).
 */
export const DELEGATE_TASKS_TOOL = {
  type: "function" as const,
  function: {
    name: "delegate_tasks",
    description: "Delegate self-contained coding task(s) to coder sub-agent(s) that run a separate coder model in this same workspace. Use this to offload the heavy implementation work. Each task must be fully self-contained because the sub-agent does NOT see this conversation — give it a clear title and detailed instructions. You receive each sub-agent's result summary back. Set parallel=true ONLY when the tasks touch disjoint files; otherwise leave it false so they run sequentially.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "The coding tasks to delegate (1 to 3). Each runs in its own coder sub-agent.",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short title for this sub-task." },
              instructions: { type: "string", description: "Complete, self-contained instructions: which files to create/edit, the exact behavior/contract, and all context the coder needs. The sub-agent only sees this text." },
              files: {
                type: "array",
                description: "Optional: the files this task is expected to touch (helps you reason about conflicts for the parallel flag).",
                items: { type: "string" }
              }
            },
            required: ["title", "instructions"]
          }
        },
        parallel: {
          type: "boolean",
          description: "Run the sub-agents concurrently. Set true ONLY if the tasks touch disjoint files and cannot conflict; otherwise false (sequential)."
        }
      },
      required: ["tasks"]
    }
  }
};

/**
 * Lightweight tier tool. Lets the architect delegate tiny, mechanical tasks
 * (locating files/symbols, summarizing a file, simple renames/moves) to a cheap
 * "utility" sub-agent running the configured utility model in this same workspace.
 * The sub-agent only gets read/list/search + move_file, does the noisy churn in
 * its own context, and returns a SHORT distilled answer — keeping the architect's
 * context lean. Like delegate_tasks it performs no direct I/O itself (the
 * orchestrator runs the sub-agent loop), so it is not in DANGEROUS_TOOLS.
 */
export const DELEGATE_UTILITY_TOOL = {
  type: "function" as const,
  function: {
    name: "delegate_to_utility",
    description: "Delegate TINY, mechanical task(s) to a cheap utility sub-agent (a smaller model) to keep your own context lean. Ideal for: locating where a file/symbol/function lives, summarizing a file, or simple renames/moves. The utility sub-agent can ONLY read/list/search files and move (rename) them — it cannot write or edit code. Each task is self-contained (the sub-agent does NOT see this conversation) and returns a SHORT answer (e.g. a file:line or a one-paragraph summary). Use delegate_tasks (the coder) for substantial implementation; use this only for cheap lookups/renames. Set parallel=true only when tasks are independent.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "The tiny tasks to delegate (1 to 3). Each runs in its own utility sub-agent.",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short title for this lookup/task." },
              instructions: { type: "string", description: "Complete, self-contained instructions and exactly what short answer to return. The sub-agent only sees this text." }
            },
            required: ["title", "instructions"]
          }
        },
        parallel: {
          type: "boolean",
          description: "Run the utility sub-agents concurrently. Set true only when the tasks are independent."
        }
      },
      required: ["tasks"]
    }
  }
};

/** Tools that must always be gated behind an explicit permission prompt. */
export const DANGEROUS_TOOLS = new Set(["run_command", "fetch_url"]);

/**
 * Read-only tools — they only inspect the workspace, never mutate it or run
 * commands. These are the ONLY workspace tools allowed in plan mode (which is a
 * planning-only, no-changes mode). Everything else is blocked there.
 */
export const READONLY_TOOLS = new Set(["read_file", "list_directory", "search_files"]);

/**
 * Modifying tools — tools that create, modify, move, or delete files or directories,
 * or run shell commands. These are blocked in non-build modes.
 */
export const MODIFYING_TOOLS = new Set(["write_file", "edit_file", "delete_file", "create_directory", "move_file", "run_command"]);

/**
 * Tools available to a utility sub-agent: read-only inspection plus move_file
 * (rename/move). No write/edit/delete/create — utility work is lookups + safe
 * renames only.
 */
export const UTILITY_TOOL_NAMES = new Set([...READONLY_TOOLS, "move_file"]);
export const UTILITY_TOOLS = WORKSPACE_TOOLS.filter(t => UTILITY_TOOL_NAMES.has(t.function.name));

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
  if (tool === "fetch_url") {
    // Scope the grant to the host, so approving one site does not approve the
    // whole web. The host is stashed in the `command` slot of the key.
    let host = "";
    try {
      const raw = String(JSON.parse(toolCall.function.arguments || "{}").url ?? "").trim();
      host = new URL(raw).host;
    } catch {
      host = "";
    }
    return { tool, command: host };
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
    case "fetch_url":
      return {
        tool: "fetch_url",
        action: "fetch",
        path: "",
        absolutePath: baseDir,
        oldContent: null,
        newContent: null,
        url: typeof args.url === "string" ? args.url : ""
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
      case "fetch_url":
        // Network access, so it is gated like run_command. Returns a promise
        // that the caller awaits via executeWorkspaceToolAsync.
        return JSON.stringify({ success: false, error: "fetch_url must be executed via executeWorkspaceToolAsync." });
      default:
        throw new Error(`Unknown function: ${toolCall.function.name}`);
    }
  } catch (err: any) {
    return JSON.stringify({ success: false, error: err.message });
  }
}

/**
 * Async variant of executeWorkspaceTool. Identical for synchronous tools, but
 * handles fetch_url (the only tool that performs network I/O) by awaiting the
 * HTTP request. The orchestrator should call this so web fetches resolve.
 */
export async function executeWorkspaceToolAsync(run: Run, toolCall: ToolCall): Promise<string> {
  if (toolCall.function.name !== "fetch_url") {
    return executeWorkspaceTool(run, toolCall);
  }
  try {
    const args = JSON.parse(toolCall.function.arguments);
    return await fetchUrl(typeof args.url === "string" ? args.url : "");
  } catch (err: any) {
    return JSON.stringify({ success: false, error: err.message });
  }
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
      headers: { "User-Agent": "AgentBridge/1.0 (+local workspace assistant)" }
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
