import fs from "node:fs";
import path from "node:path";
import type { Run, ToolCall } from "@bridgemind/shared";

/**
 * Tool schemas advertised to the model. The orchestrator is the only place
 * that knows how to execute these; providers just forward the definitions.
 */
export const WORKSPACE_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Writes or overwrites content to a specified file in the local workspace directory.",
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
  }
];

/**
 * Executes a single workspace tool call against the run's project directory.
 * All file access is constrained to the workspace; any failure is returned as
 * a JSON error string rather than thrown, so the model can react to it.
 */
export function executeWorkspaceTool(run: Run, toolCall: ToolCall): string {
  try {
    const args = JSON.parse(toolCall.function.arguments);
    const relativePath = args.path;
    if (relativePath === undefined || relativePath === null) {
      throw new Error("Missing parameter: path");
    }

    // Resolve absolute path safely and ensure it stays inside the workspace.
    const baseDir = path.resolve(run.projectPath || process.cwd());
    const absolutePath = path.resolve(baseDir, relativePath);
    const isInside = absolutePath === baseDir || absolutePath.startsWith(baseDir + path.sep);
    if (!isInside) {
      throw new Error(`Access denied: path '${relativePath}' is outside of the workspace directory.`);
    }

    switch (toolCall.function.name) {
      case "write_file": {
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, args.content || "", "utf-8");
        return JSON.stringify({ success: true, message: `File written successfully at ${relativePath}` });
      }
      case "delete_file": {
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
          return JSON.stringify({ success: true, message: `File deleted successfully at ${relativePath}` });
        }
        return JSON.stringify({ success: false, message: `File not found at ${relativePath}` });
      }
      case "read_file": {
        if (!fs.existsSync(absolutePath)) {
          return JSON.stringify({ success: false, error: `File not found at ${relativePath}` });
        }
        if (fs.statSync(absolutePath).isDirectory()) {
          throw new Error(`Path '${relativePath}' is a directory, not a file. Use list_directory instead.`);
        }
        return JSON.stringify({ success: true, content: fs.readFileSync(absolutePath, "utf-8") });
      }
      case "list_directory": {
        if (!fs.existsSync(absolutePath)) {
          return JSON.stringify({ success: false, error: `Directory not found at ${relativePath}` });
        }
        if (!fs.statSync(absolutePath).isDirectory()) {
          throw new Error(`Path '${relativePath}' is a file, not a directory. Use read_file instead.`);
        }
        const files = fs.readdirSync(absolutePath).map(file => {
          const fileStat = fs.statSync(path.join(absolutePath, file));
          return { name: file, isDirectory: fileStat.isDirectory(), size: fileStat.size };
        });
        return JSON.stringify({ success: true, files });
      }
      default:
        throw new Error(`Unknown function: ${toolCall.function.name}`);
    }
  } catch (err: any) {
    return JSON.stringify({ success: false, error: err.message });
  }
}
