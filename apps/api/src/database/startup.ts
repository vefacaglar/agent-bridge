import type { DatabaseSync } from "node:sqlite";
import path from "path";

export function runStartupTasks(db: DatabaseSync, wsRoot: string, defaultProjectName: string) {
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
}
