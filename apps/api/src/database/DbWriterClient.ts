import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface DbWriteRequest {
  op: string;
  args?: Record<string, unknown>;
}

function findWorkspaceRoot(): string {
  let currentDir = process.cwd();
  const rootDir = path.parse(currentDir).root;
  while (currentDir !== rootDir) {
    if (fs.existsSync(path.join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return process.cwd();
}

function bundledWriterPath(): string | null {
  const candidates = [
    process.env.LOCAGENS_DB_WRITER_PATH,
    process.env.LOCAGENS_DB_WRITER_PATH_ARM64,
    process.env.LOCAGENS_DB_WRITER_PATH_X64
  ].filter((p): p is string => !!p);
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

export class DbWriterClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private stderrTail = "";

  constructor(private dbPath: string, private timeoutMs = 15000) {}

  async write<T = unknown>(request: DbWriteRequest): Promise<T> {
    const child = this.ensureStarted();
    const id = String(this.nextId++);
    const payload = JSON.stringify({ id, ...request }) + "\n";

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DB writer timed out for ${request.op}.`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timer
      });

      child.stdin.write(payload, "utf8", (err) => {
        if (!err) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(err);
      });
    });
  }

  close(): void {
    if (!this.child) return;
    this.child.stdin.end();
    this.child.kill();
    this.child = null;
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;

    const explicit = bundledWriterPath();
    const wsRoot = findWorkspaceRoot();
    const command = explicit ?? "go";
    const args = explicit ? [] : ["run", "."];
    const cwd = explicit ? undefined : path.join(wsRoot, "apps/db-writer");
    const goCache = process.env.GOCACHE || path.join(wsRoot, ".locagens-dev", "go-cache");
    if (!explicit) {
      fs.mkdirSync(goCache, { recursive: true });
    }

    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        GOCACHE: goCache,
        LOCAGENS_DB_PATH: this.dbPath
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000);
    });
    child.on("exit", (code, signal) => {
      const err = new Error(`DB writer exited (${signal ?? code ?? "unknown"}). ${this.stderrTail}`.trim());
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(err);
        this.pending.delete(id);
      }
      if (this.child === child) this.child = null;
    });

    return child;
  }

  private handleLine(line: string): void {
    let response: any;
    try {
      response = JSON.parse(line);
    } catch {
      return;
    }

    const id = String(response.id ?? "");
    const pending = this.pending.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(new Error(response.error || "DB writer request failed."));
    }
  }
}
