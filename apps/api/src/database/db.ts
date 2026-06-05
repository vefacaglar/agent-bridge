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
const dbPath = path.join(wsRoot, "bridgemind.db");

console.log(`[Database] Connecting to SQLite database at: ${dbPath}`);
export const db = new DatabaseSync(dbPath);

// Create Runs Table
db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL,

    planner_provider_id TEXT NOT NULL,
    planner_provider_display_name TEXT NOT NULL,
    planner_model TEXT NOT NULL,

    coder_provider_id TEXT NOT NULL,
    coder_provider_display_name TEXT NOT NULL,
    coder_model TEXT NOT NULL,

    max_rounds INTEGER NOT NULL,
    current_round INTEGER NOT NULL DEFAULT 0,

    source_run_id TEXT,
    retry_type TEXT,

    final_output TEXT,
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

console.log("[Database] Database initialized and tables verified.");
