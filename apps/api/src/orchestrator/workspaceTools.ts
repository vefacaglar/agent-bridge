import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
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
      description: "Create or overwrite a workspace file. Prefer edit_file for small changes.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path."
          },
          content: {
            type: "string",
            description: "Exact file content."
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
      description: "Replace exact text in an existing file. old_string must match exactly.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path."
          },
          old_string: {
            type: "string",
            description: "Exact text to replace. Must be unique unless replace_all is true."
          },
          new_string: {
            type: "string",
            description: "Replacement text."
          },
          replace_all: {
            type: "boolean",
            description: "Replace every occurrence. Defaults to false."
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
      description: "Delete a workspace file.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path."
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
      description: "Read a workspace file.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative file path."
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
      description: "List files and folders in a workspace directory.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative directory path; use '' or '.' for root."
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
      description: "Create a workspace directory, including parents.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Workspace-relative directory path."
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
      description: "Move or rename a workspace file or directory.",
      parameters: {
        type: "object",
        properties: {
          source_path: {
            type: "string",
            description: "Current workspace-relative path."
          },
          destination_path: {
            type: "string",
            description: "New workspace-relative path."
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
      description: "Search workspace file names and contents. Skips node_modules and .git.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to search for."
          },
          path: {
            type: "string",
            description: "Optional workspace-relative subdirectory."
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
      description: "Run a shell command in the workspace. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Command to execute."
          }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "search_web",
      description: "Search the web and return top text results with title, URL, and snippet. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Web search query."
          },
          max_results: {
            type: "number",
            description: "Maximum number of results to return, from 1 to 10. Defaults to 5."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "fetch_url",
      description: "Fetch an http(s) URL as text. Requires user approval.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Absolute http(s) URL."
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
    description: "Record or revise the stable plan-panel document. Put detailed prose in body and steps in tasks; do not use it for progress updates.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short plan title."
        },
        body: {
          type: "string",
          description: "Full markdown plan shown in the panel."
        },
        tasks: {
          type: "array",
          description: "Ordered plan steps with status.",
          items: {
            type: "object",
            properties: {
              text: { type: "string", description: "Step text." },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Step status."
              }
            },
            required: ["text", "status"]
          }
        },
        start_new: {
          type: "boolean",
          description: "True to replace a finished plan with a new effort."
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
    description: "Set this chat's short title once intent is clear.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short title, 3-6 words, no quotes."
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
    description: "Ask 1-4 multiple-choice questions only for decisions you cannot resolve from context or sensible defaults.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "Questions to ask.",
          items: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "Clear question text."
              },
              header: {
                type: "string",
                description: "Short label, max 12 chars."
              },
              multiSelect: {
                type: "boolean",
                description: "Allow multiple selections."
              },
              options: {
                type: "array",
                description: "Distinct choices.",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "Choice label." },
                    description: { type: "string", description: "Optional one-line explanation." }
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
    description: "Save a durable preference, feedback, project fact, or reference in ENGLISH. Do not save transient details, secrets, or facts already in code/config.",
    parameters: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["global", "project"],
          description: "global for user-wide facts; project for this codebase."
        },
        category: {
          type: "string",
          enum: ["user", "feedback", "project", "reference"],
          description: "Memory category."
        },
        content: {
          type: "string",
          description: "Fact to remember, 1-3 concise English sentences."
        },
        update_id: {
          type: "number",
          description: "Existing memory id to update."
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
    description: "Delegate 1-3 self-contained coding tasks to coder sub-agents. Use parallel only for disjoint files.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "Coding tasks to delegate.",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short task title." },
              instructions: { type: "string", description: "Self-contained instructions (sub-agent sees only this). Keep short: describe the change and cite file paths; do NOT paste file contents — the coder reads files itself." },
              files: {
                type: "array",
                description: "Expected touched files.",
                items: { type: "string" }
              },
              verify: {
                type: "boolean",
                description: "Read-only verification task: the sub-agent may only read/list/search and must return a SHORT verdict on whether earlier changes are correct."
              }
            },
            required: ["title", "instructions"]
          }
        },
        parallel: {
          type: "boolean",
          description: "Run concurrently only when tasks cannot conflict."
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
 * The sub-agent only gets read/list/search + move_file. It cannot run commands,
 * delete, edit, write, create, or delegate. It returns a SHORT distilled answer,
 * keeping the architect's context lean. Like delegate_tasks it performs no direct
 * I/O itself (the orchestrator runs the sub-agent loop), so it is not in
 * DANGEROUS_TOOLS.
 */
export const DELEGATE_UTILITY_TOOL = {
  type: "function" as const,
  function: {
    name: "delegate_to_utility",
    description: "Delegate 1-3 tiny lookup/summary/move tasks to utility sub-agents. No shell/delete/write/edit.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "Tiny utility tasks.",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Short task title." },
              instructions: { type: "string", description: "Self-contained instructions and the short answer wanted. Cite file paths; do NOT paste file contents — utility reads files itself." }
            },
            required: ["title", "instructions"]
          }
        },
        parallel: {
          type: "boolean",
          description: "Run concurrently only for independent tasks."
        }
      },
      required: ["tasks"]
    }
  }
};

/** Tools that must always be gated behind an explicit permission prompt. */
export const DANGEROUS_TOOLS = new Set(["run_command", "search_web", "fetch_url"]);

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
  if (tool === "search_web") {
    let query = "";
    try {
      query = String(JSON.parse(toolCall.function.arguments || "{}").query ?? "").trim();
    } catch {
      query = "";
    }
    return { tool, command: query };
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

/**
 * Heuristic: does this shell command try to leave the project workspace? Such
 * commands (changing into a parent/absolute/home directory, or traversing with
 * "..") ALWAYS require an approval prompt — even in Full Access, and even when a
 * standing grant would otherwise cover the command family. Returning true forces
 * a prompt and prevents the command from being silently granted/auto-granted.
 *
 * Care: Go-style "./pkg/..." wildcards are NOT parent traversal — the dots are
 * bounded so "..." does not trip the "../" check.
 */
export function commandEscapesWorkspace(command: string): boolean {
  if (!command) return false;
  // Parent-directory traversal as a real path segment: "..", "../x", "/.." — but
  // not "..." (the next char after ".." must be a separator/quote or end).
  if (/(^|[\s/'"=:(])\.\.([/\s'"]|$)/.test(command)) return true;
  // Home-directory references: "~", "~/...".
  if (/(^|[\s'"=:(])~($|[/\s'"])/.test(command)) return true;
  // Changing directory to an absolute, home, or parent location.
  if (/\b(cd|pushd|chdir)\s+['"]?(\/|~|\.\.)/.test(command)) return true;
  return false;
}

export function commandScansOutsideWorkspace(command: string): boolean {
  if (!command) return false;
  return /(^|[;&|]\s*)find\s+['"]?(\/|~|\.\.)([\s/'"]|$)/.test(command);
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
    case "search_web":
      return {
        tool: "search_web",
        action: "search",
        path: "",
        absolutePath: baseDir,
        oldContent: null,
        newContent: null,
        query: typeof args.query === "string" ? args.query : ""
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
    throw new Error("old_string was not found in the file. read_file it first and copy the exact text to replace, including whitespace and indentation.");
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
        return JSON.stringify({ success: false, error: "run_command must be executed via executeWorkspaceToolAsync." });
      }
      case "search_web":
        return JSON.stringify({ success: false, error: "search_web must be executed via executeWorkspaceToolAsync." });
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
