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
const dbPath = isTest ? ":memory:" : (process.env.BRIDGEMIND_DB_PATH || path.join(wsRoot, "bridgemind.db"));

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
    raw_response TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
  );
`);

// Create Projects Table
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    path TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Create Permissions Table
db.exec(`
  CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    project_path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    UNIQUE(scope, project_path)
  );
`);

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
  const stmt = db.prepare(`
    UPDATE runs 
    SET status = 'failed', error_message = 'Session interrupted due to server restart.' 
    WHERE status IN ('created', 'generating', 'awaiting_permission')
  `);
  const info = stmt.run();
  if (info.changes > 0) {
    console.log(`[Database] Cleaned up ${info.changes} stuck runs from previous session.`);
  }
} catch (err: any) {
  console.error("[Database] Failed to clean up stuck runs:", err.message);
}

console.log("[Database] Database initialized and tables verified.");

