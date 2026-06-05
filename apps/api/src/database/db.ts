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

    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

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

// Seed default project if empty
const projectCount = db.prepare("SELECT count(*) as count FROM projects").get() as { count: number };
if (projectCount.count === 0) {
  db.prepare(`
    INSERT INTO projects (path, name, created_at)
    VALUES (?, ?, ?)
  `).run(wsRoot, defaultProjectName, new Date().toISOString());
}

console.log("[Database] Database initialized and tables verified.");

