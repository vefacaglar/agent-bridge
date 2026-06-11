import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { DbWriterClient, type DbWriteRequest } from "./DbWriterClient.js";
import { setupSchema } from "./schema.js";
import { runMigrations } from "./migrations.js";
import { runStartupTasks } from "./startup.js";

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

const wsRoot = findWorkspaceRoot();
const defaultProjectName = "Locagens";
const isTest = process.env.NODE_ENV === "test";
const dbPath = isTest ? ":memory:" : (process.env.LOCAGENS_DB_PATH || path.join(wsRoot, "locagens.db"));
const useDbWriter = dbPath !== ":memory:" && process.env.LOCAGENS_DB_WRITER_DISABLED !== "1";

console.log(`[Database] Connecting to SQLite database at: ${dbPath}`);
if (dbPath !== ":memory:") {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}
export const db = new DatabaseSync(dbPath);
const dbWriter = useDbWriter ? new DbWriterClient(dbPath) : null;

try {
  db.exec("PRAGMA busy_timeout = 10000");
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
  }
} catch (err: any) {
  console.warn(`[Database] Failed to apply SQLite concurrency pragmas: ${err.message}`);
}

function isDatabaseLocked(err: any): boolean {
  const message = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "").toUpperCase();
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || message.includes("database is locked");
}

function wait(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * SQLite allows only one writer at a time. If another connection/process has
 * the write lock, wait briefly and retry instead of surfacing "database is
 * locked" to the run.
 */
export function runQueuedWrite<T>(operation: () => T): T {
  const delays = [15, 30, 60, 120, 250, 500, 1000, 1500, 2000, 2500];
  for (let attempt = 0; ; attempt++) {
    try {
      return operation();
    } catch (err) {
      if (!isDatabaseLocked(err) || attempt >= delays.length) throw err;
      wait(delays[attempt]);
    }
  }
}

export async function runDbWrite<T>(request: DbWriteRequest, fallback: () => T): Promise<T> {
  if (dbWriter) {
    return await dbWriter.write<T>(request);
  }
  return runQueuedWrite(fallback);
}

// Run database initialization steps
setupSchema(db, wsRoot, defaultProjectName);
runMigrations(db);
runStartupTasks(db, wsRoot, defaultProjectName);

console.log("[Database] Database initialized and tables verified.");
