import type { DatabaseSync } from "node:sqlite";

export function runMigrations(db: DatabaseSync) {
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

  // Migration: the original schema only had UNIQUE(scope, project_path) and no
  // tool/command columns — a single grant meant "allow every tool". That blanket
  // semantics conflicts with per-command approval, so the legacy table is dropped
  // and rebuilt; the user simply re-approves on next use.
  const permCols = db.prepare("PRAGMA table_info(permissions)").all() as { name: string }[];
  if (permCols.length > 0 && !permCols.some((c) => c.name === "tool")) {
    console.log("[Database] Migrating permissions table to per-tool/command grants (clearing legacy blanket grants).");
    db.exec("DROP TABLE permissions");
  }

  // Migration: Add duration_ms column to usage_logs if missing.
  try {
    db.exec("ALTER TABLE usage_logs ADD COLUMN duration_ms INTEGER");
  } catch (e) {
    // Ignored if column already exists
  }
}
