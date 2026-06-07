import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { DbWriterClient, type DbWriteRequest } from "./DbWriterClient.js";

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

// Create Runs Table
db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    task TEXT NOT NULL,
    project_path TEXT NOT NULL DEFAULT '${wsRoot.replace(/'/g, "''")}',
    project_name TEXT NOT NULL DEFAULT '${defaultProjectName.replace(/'/g, "''")}',
    status TEXT NOT NULL,

    provider_id TEXT NOT NULL,
    provider_display_name TEXT NOT NULL,
    model TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'accept_edits',

    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_active_at TEXT
  );
`);

// Migration: Add mode column to runs if it doesn't already exist
try {
  db.exec("ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'accept_edits'");
} catch (e) {
  // Ignored if column already exists or runs table schema migration is not needed
}

// Migration: Add last_active_at column to runs if missing.
try {
  db.exec("ALTER TABLE runs ADD COLUMN last_active_at TEXT");
} catch (e) {
  // Ignored if column already exists
}

// Populate last_active_at if null on startup
try {
  db.exec("UPDATE runs SET last_active_at = COALESCE(updated_at, created_at) WHERE last_active_at IS NULL");
} catch (e) {
  // Ignored
}

// Migration: Add dual-model (architect + coder) columns to runs. All nullable;
// populated only when a run uses an agent preset that delegates to a coder model.
for (const col of ["coder_provider_id", "coder_model", "agent_preset", "utility_provider_id", "utility_model"]) {
  try {
    db.exec(`ALTER TABLE runs ADD COLUMN ${col} TEXT`);
  } catch (e) {
    // Ignored if the column already exists
  }
}

for (const col of ["coder_reasoning_effort", "utility_reasoning_effort"]) {
  try {
    db.exec(`ALTER TABLE runs ADD COLUMN ${col} TEXT`);
  } catch (e) {
    // Ignored if the column already exists
  }
}

// Migration: Add optional reasoning-effort selection to runs.
try {
  db.exec("ALTER TABLE runs ADD COLUMN reasoning_effort TEXT");
} catch (e) {
  // Ignored if the column already exists
}

// Create Messages Table
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    role TEXT NOT NULL,
    agent_role TEXT,
    agent_name TEXT,
    provider_id TEXT,
    provider_display_name TEXT,
    model TEXT,
    content TEXT NOT NULL,
    reasoning_content TEXT,
    raw_response TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
  );
`);

// Migration: Add reasoning_content column to messages if it doesn't already exist
try {
  db.exec("ALTER TABLE messages ADD COLUMN reasoning_content TEXT");
} catch (e) {
  // Ignored if column already exists
}

// Migration: Add agent_name column (per coder sub-agent identity) if missing.
try {
  db.exec("ALTER TABLE messages ADD COLUMN agent_name TEXT");
} catch (e) {
  // Ignored if column already exists
}

// Create Projects Table
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Create Permissions Table.
// Grants are keyed per tool and (for run_command) per exact command, so
// approving "dotnet build" does not also approve "dotnet build -f".
//
// Migration: the original schema only had UNIQUE(scope, project_path) and no
// tool/command columns — a single grant meant "allow every tool". That blanket
// semantics conflicts with per-command approval, so the legacy table is dropped
// and rebuilt; the user simply re-approves on next use.
const permCols = db.prepare("PRAGMA table_info(permissions)").all() as { name: string }[];
if (permCols.length > 0 && !permCols.some((c) => c.name === "tool")) {
  console.log("[Database] Migrating permissions table to per-tool/command grants (clearing legacy blanket grants).");
  db.exec("DROP TABLE permissions");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    project_path TEXT NOT NULL DEFAULT '',
    tool TEXT NOT NULL DEFAULT '',
    command TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    UNIQUE(scope, project_path, tool, command)
  );
`);

// Create Plans Table.
// Each run can have multiple plans over time (a new one supersedes the old when
// the assistant finishes a plan and starts another). The active plan is the one
// shown in the right-hand plan panel. Maintained by the update_plan tool.
db.exec(`
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Plan',
    body TEXT,
    tasks TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
  );
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_plans_run ON plans(run_id)");

// Create Memory Table.
// Durable facts the assistant remembers across sessions via the `remember` tool.
// Mirrors the permissions table's scope/project_path shape: a 'global' memory
// (project_path = '') applies to every run; a 'project' memory only to runs for
// that project path. Managed by the user in Settings → Memory.
db.exec(`
  CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    project_path TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'project',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_memory_scope_project ON memory(scope, project_path)");

// Seed default project if empty
const projectCount = db.prepare("SELECT count(*) as count FROM projects").get() as { count: number };
if (projectCount.count === 0) {
  db.prepare(`
    INSERT INTO projects (path, name, created_at)
    VALUES (?, ?, ?)
  `).run(wsRoot, defaultProjectName, new Date().toISOString());
}
db.prepare(`
  UPDATE projects
  SET name = ?
  WHERE path IN (?, ?) AND name = ?
`).run(defaultProjectName, wsRoot, `${wsRoot}/`, path.basename(wsRoot));

// Reset any runs left in active states on startup
try {
  const stuckRuns = db.prepare(`
    SELECT id FROM runs 
    WHERE status IN ('created', 'generating', 'awaiting_permission')
  `).all() as { id: string }[];

  if (stuckRuns.length > 0) {
    const updateRun = db.prepare(`
      UPDATE runs 
      SET status = 'failed', error_message = 'Session interrupted due to server restart.' 
      WHERE id = ?
    `);
    const insertMessage = db.prepare(`
      INSERT INTO messages (id, run_id, role, content, created_at)
      VALUES (?, ?, 'system', 'Session interrupted due to server restart.', ?)
    `);

    for (const r of stuckRuns) {
      updateRun.run(r.id);
      insertMessage.run(`msg-err-restart-${r.id}-${Date.now()}`, r.id, new Date().toISOString());
    }
  }
} catch (err: any) {
  console.error("[Database] Failed to clean up stuck runs:", err.message);
}

console.log("[Database] Database initialized and tables verified.");
