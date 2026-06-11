import { DatabaseSync } from "node:sqlite";
import type { Plan, PlanTask } from "@locagens/shared";
import { runDbWrite } from "../db.js";
import type { IPlanRepository, PlanInput } from "./interfaces.js";

function normalizeTask(raw: any): PlanTask | null {
  const text = typeof raw?.text === "string" ? raw.text.trim() : "";
  if (!text) return null;
  const status = raw?.status === "in_progress" || raw?.status === "completed" ? raw.status : "pending";
  return { text, status };
}

function mapRowToPlan(row: any): Plan {
  let tasks: PlanTask[] = [];
  try {
    const parsed = JSON.parse(row.tasks || "[]");
    if (Array.isArray(parsed)) tasks = parsed.map(normalizeTask).filter((t): t is PlanTask => t !== null);
  } catch {
    tasks = [];
  }
  return {
    id: row.id,
    runId: row.run_id,
    title: row.title,
    body: row.body || undefined,
    tasks,
    status: row.status === "completed" ? "completed" : "active",
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class PlanRepository implements IPlanRepository {
  constructor(private db: DatabaseSync) {}

  getActive(runId: string): Plan | null {
    const row = this.db
      .prepare("SELECT * FROM plans WHERE run_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1")
      .get(runId) as any;
    return row ? mapRowToPlan(row) : null;
  }

  listByRunId(runId: string): Plan[] {
    const rows = this.db.prepare("SELECT * FROM plans WHERE run_id = ? ORDER BY version ASC").all(runId) as any[];
    return rows.map(mapRowToPlan);
  }

  /**
   * Creates or updates the active plan for a run. With `startNew` (or when no
   * active plan exists) it supersedes any previous active plan and inserts a new
   * versioned one; otherwise it overwrites the current active plan in place.
   */
  async upsert(runId: string, input: PlanInput): Promise<Plan> {
    const now = new Date().toISOString();
    const tasks = (input.tasks || []).map(normalizeTask).filter((t): t is PlanTask => t !== null);
    const tasksJson = JSON.stringify(tasks);
    const existing = this.getActive(runId);

    if (existing && !input.startNew) {
      await runDbWrite({
        op: "plan.updateActive",
        args: {
          existingId: existing.id,
          title: input.title?.trim() || existing.title,
          body: input.body ?? existing.body ?? null,
          tasksJson,
          now
        }
      }, () => this.db.prepare(`
        UPDATE plans SET title = ?, body = ?, tasks = ?, status = 'active', updated_at = ? WHERE id = ?
      `).run(
        input.title?.trim() || existing.title,
        input.body ?? existing.body ?? null,
        tasksJson,
        now,
        existing.id
      ));
      return this.getActive(runId)!;
    }

    if (existing && input.startNew) {
      await runDbWrite({ op: "plan.complete", args: { id: existing.id, updatedAt: now } }, () => this.db.prepare("UPDATE plans SET status = 'completed', updated_at = ? WHERE id = ?").run(now, existing.id));
    }

    const id = `plan-${runId}-${Date.now()}`;
    const version = existing ? existing.version + 1 : 1;
    await runDbWrite({ op: "plan.create", args: { id, runId, title: input.title?.trim() || "Plan", body: input.body ?? null, tasksJson, version, now } }, () => this.db.prepare(`
      INSERT INTO plans (id, run_id, title, body, tasks, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, runId, input.title?.trim() || "Plan", input.body ?? null, tasksJson, version, now, now));

    return this.getActive(runId)!;
  }
}
