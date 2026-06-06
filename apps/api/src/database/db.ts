import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";

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
const defaultProjectName = path.basename(wsRoot);
const isTest = process.env.NODE_ENV === "test";
const dbPath = isTest ? ":memory:" : (process.env.AGENT_BRIDGE_DB_PATH || path.join(wsRoot, "agent-bridge.db"));

console.log(`[Database] Connecting to SQLite database at: ${dbPath}`);
export const db = new DatabaseSync(dbPath);

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
    updated_at TEXT NOT NULL
  );
`);

// Migration: Add mode column to runs if it doesn't already exist
try {
  db.exec("ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'accept_edits'");
} catch (e) {
  // Ignored if column already exists or runs table schema migration is not needed
}

// Migration: Add dual-model (architect + coder) columns to runs. All nullable;
// populated only when a run uses an agent preset that delegates to a coder model.
for (const col of ["coder_provider_id", "coder_model", "agent_preset"]) {
  try {
    db.exec(`ALTER TABLE runs ADD COLUMN ${col} TEXT`);
  } catch (e) {
    // Ignored if the column already exists
  }
}

// Create Messages Table
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    role TEXT NOT NULL,
    agent_role TEXT,
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

// Seed default project if empty
const projectCount = db.prepare("SELECT count(*) as count FROM projects").get() as { count: number };
if (projectCount.count === 0) {
  db.prepare(`
    INSERT INTO projects (path, name, created_at)
    VALUES (?, ?, ?)
  `).run(wsRoot, defaultProjectName, new Date().toISOString());
}

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
    console.log(`[Database] Cleaned up ${stuckRuns.length} stuck runs from previous session and added system error messages.`);
  }
} catch (err: any) {
  console.error("[Database] Failed to clean up stuck runs:", err.message);
}

console.log("[Database] Database initialized and tables verified.");

