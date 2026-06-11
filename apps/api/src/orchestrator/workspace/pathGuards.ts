import fs from "node:fs";
import path from "node:path";

/**
 * Shared path/argument/output guards for the workspace tool layer. Every file
 * access must go through resolveInside so a tool call can never escape the
 * run's project directory.
 */

/** Resolves a workspace-relative path to an absolute one, refusing to escape. */
export function resolveInside(baseDir: string, relativePath: string): string {
  const absolutePath = path.resolve(baseDir, relativePath);
  const isInside = absolutePath === baseDir || absolutePath.startsWith(baseDir + path.sep);
  if (!isInside) {
    throw new Error(`Access denied: path '${relativePath}' is outside of the workspace directory.`);
  }
  return absolutePath;
}

/** Reads a file's current content, or null if it is missing/unreadable. */
export function readExistingFile(absolutePath: string): string | null {
  try {
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      return fs.readFileSync(absolutePath, "utf-8");
    }
  } catch {
    /* ignore unreadable files */
  }
  return null;
}

/** Ensures a required path argument is present, returning it. */
export function requirePath(value: unknown, name = "path"): string {
  if (value === undefined || value === null) {
    throw new Error(`Missing parameter: ${name}`);
  }
  return String(value);
}

/** Caps command output so a noisy build doesn't blow up the context window. */
export function truncateOutput(output: string): string {
  const MAX = 20_000;
  if (output.length <= MAX) return output;
  return output.slice(0, MAX) + `\n... [output truncated, ${output.length - MAX} more characters]`;
}
