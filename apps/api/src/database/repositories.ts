import type { Run, RunMessage, RunStatus, Project, PermissionRule, Plan, PlanTask } from "@agent-bridge/shared";
import { db } from "./db.js";


// Mapper from database row to Run model
function mapRowToRun(row: any): Run {
  return {
    id: row.id,
    title: row.title,
    task: row.task,
    projectPath: row.project_path || undefined,
    projectName: row.project_name || undefined,
    status: row.status as RunStatus,
    providerId: row.provider_id,
    providerDisplayName: row.provider_display_name,
    model: row.model,
    mode: row.mode || "accept_edits",
    coderProviderId: row.coder_provider_id || undefined,
    coderModel: row.coder_model || undefined,
    utilityProviderId: row.utility_provider_id || undefined,
    utilityModel: row.utility_model || undefined,
    agentPreset: row.agent_preset || undefined,
    errorMessage: row.error_message || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Mapper from database row to RunMessage model
function mapRowToMessage(row: any): RunMessage {
  return {
    id: row.id,
    runId: row.run_id,
    role: row.role as "system" | "user" | "assistant" | "tool",
    agentRole: row.agent_role || undefined,
    agentName: row.agent_name || undefined,
    providerId: row.provider_id || undefined,
    providerDisplayName: row.provider_display_name || undefined,
    model: row.model || undefined,
    content: row.content,
    reasoningContent: row.reasoning_content || undefined,
    rawResponse: row.raw_response || undefined,
    createdAt: row.created_at
  };
}

export class RunRepository {
  create(run: Run): void {
    const stmt = db.prepare(`
      INSERT INTO runs (
        id, title, task, project_path, project_name, status,
        provider_id, provider_display_name, model, mode,
        coder_provider_id, coder_model, agent_preset,
        utility_provider_id, utility_model,
        error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      run.id,
      run.title,
      run.task,
      run.projectPath || process.cwd(),
      run.projectName || "Workspace",
      run.status,
      run.providerId,
      run.providerDisplayName,
      run.model,
      run.mode || "accept_edits",
      run.coderProviderId || null,
      run.coderModel || null,
      run.agentPreset || null,
      run.utilityProviderId || null,
      run.utilityModel || null,
      run.errorMessage || null,
      run.createdAt,
      run.updatedAt
    );
  }

  getById(id: string): Run | null {
    const stmt = db.prepare("SELECT * FROM runs WHERE id = ?");
    const row = stmt.get(id) as any;
    return row ? mapRowToRun(row) : null;
  }

  list(): Run[] {
    const stmt = db.prepare("SELECT * FROM runs ORDER BY created_at DESC");
    const rows = stmt.all() as any[];
    return rows.map(mapRowToRun);
  }

  update(id: string, updates: Partial<Run>): void {
    const fields: string[] = [];
    const values: any[] = [];

    const mappings: Record<string, string> = {
      title: "title",
      task: "task",
      projectPath: "project_path",
      projectName: "project_name",
      status: "status",
      providerId: "provider_id",
      providerDisplayName: "provider_display_name",
      model: "model",
      mode: "mode",
      coderProviderId: "coder_provider_id",
      coderModel: "coder_model",
      utilityProviderId: "utility_provider_id",
      utilityModel: "utility_model",
      agentPreset: "agent_preset",
      errorMessage: "error_message",
      createdAt: "created_at"
    };

    for (const [key, val] of Object.entries(updates)) {
      const dbField = mappings[key];
      if (dbField) {
        fields.push(`${dbField} = ?`);
        values.push(val === undefined ? null : val);
      }
    }

    if (fields.length === 0) return;

    // Automatically set updated_at if not explicitly provided
    if (!updates.updatedAt) {
      fields.push("updated_at = ?");
      values.push(new Date().toISOString());
    } else {
      fields.push("updated_at = ?");
      values.push(updates.updatedAt);
    }

    const sql = `UPDATE runs SET ${fields.join(", ")} WHERE id = ?`;
    values.push(id);

    const stmt = db.prepare(sql);
    stmt.run(...values);
  }
}

export class MessageRepository {
  create(message: RunMessage): void {
    const stmt = db.prepare(`
      INSERT INTO messages (
        id, run_id, role, agent_role, agent_name,
        provider_id, provider_display_name, model,
        content, reasoning_content, raw_response, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.id,
      message.runId,
      message.role,
      message.agentRole || null,
      message.agentName || null,
      message.providerId || null,
      message.providerDisplayName || null,
      message.model || null,
      message.content,
      message.reasoningContent || null,
      message.rawResponse || null,
      message.createdAt
    );
  }

  listByRunId(runId: string): RunMessage[] {
    const stmt = db.prepare("SELECT * FROM messages WHERE run_id = ? ORDER BY created_at ASC");
    const rows = stmt.all(runId) as any[];
    return rows.map(mapRowToMessage);
  }

  update(id: string, updates: Partial<RunMessage>): void {
    const fields: string[] = [];
    const values: any[] = [];

    const mappings: Record<string, string> = {
      content: "content",
      reasoningContent: "reasoning_content",
      rawResponse: "raw_response"
    };

    for (const [key, val] of Object.entries(updates)) {
      const dbField = mappings[key];
      if (dbField) {
        fields.push(`${dbField} = ?`);
        values.push(val === undefined ? null : val);
      }
    }

    if (fields.length === 0) return;

    const sql = `UPDATE messages SET ${fields.join(", ")} WHERE id = ?`;
    values.push(id);

    const stmt = db.prepare(sql);
    stmt.run(...values);
  }
}

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

export interface PlanInput {
  title?: string;
  body?: string;
  tasks: PlanTask[];
  startNew?: boolean;
}

export class PlanRepository {
  getActive(runId: string): Plan | null {
    const row = db
      .prepare("SELECT * FROM plans WHERE run_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1")
      .get(runId) as any;
    return row ? mapRowToPlan(row) : null;
  }

  listByRunId(runId: string): Plan[] {
    const rows = db.prepare("SELECT * FROM plans WHERE run_id = ? ORDER BY version ASC").all(runId) as any[];
    return rows.map(mapRowToPlan);
  }

  /**
   * Creates or updates the active plan for a run. With `startNew` (or when no
   * active plan exists) it supersedes any previous active plan and inserts a new
   * versioned one; otherwise it overwrites the current active plan in place.
   */
  upsert(runId: string, input: PlanInput): Plan {
    const now = new Date().toISOString();
    const tasks = (input.tasks || []).map(normalizeTask).filter((t): t is PlanTask => t !== null);
    const tasksJson = JSON.stringify(tasks);
    const existing = this.getActive(runId);

    if (existing && !input.startNew) {
      db.prepare(`
        UPDATE plans SET title = ?, body = ?, tasks = ?, status = 'active', updated_at = ? WHERE id = ?
      `).run(
        input.title?.trim() || existing.title,
        input.body ?? existing.body ?? null,
        tasksJson,
        now,
        existing.id
      );
      return this.getActive(runId)!;
    }

    if (existing && input.startNew) {
      db.prepare("UPDATE plans SET status = 'completed', updated_at = ? WHERE id = ?").run(now, existing.id);
    }

    const id = `plan-${runId}-${Date.now()}`;
    const version = existing ? existing.version + 1 : 1;
    db.prepare(`
      INSERT INTO plans (id, run_id, title, body, tasks, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, runId, input.title?.trim() || "Plan", input.body ?? null, tasksJson, version, now, now);

    return this.getActive(runId)!;
  }
}

function mapRowToProject(row: any): Project {
  return {
    path: row.path,
    name: row.name,
    createdAt: row.created_at
  };
}

export class ProjectRepository {
  create(project: Project): void {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO projects (path, name, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(project.path, project.name, project.createdAt);
  }

  list(): Project[] {
    const stmt = db.prepare("SELECT * FROM projects ORDER BY created_at ASC");
    const rows = stmt.all() as any[];
    return rows.map(mapRowToProject);
  }

  delete(path: string): void {
    const stmt = db.prepare("DELETE FROM projects WHERE path = ?");
    stmt.run(path);
  }

  get(path: string): Project | null {
    const stmt = db.prepare("SELECT * FROM projects WHERE path = ?");
    const row = stmt.get(path) as any;
    return row ? mapRowToProject(row) : null;
  }
}

function mapRowToPermission(row: any): PermissionRule {
  return {
    id: row.id,
    scope: row.scope,
    projectPath: row.project_path || "",
    tool: row.tool || "",
    command: row.command || "",
    status: row.status
  };
}

export class PermissionRepository {
  list(): PermissionRule[] {
    const rows = db.prepare("SELECT * FROM permissions ORDER BY scope, project_path, tool, command").all() as any[];
    return rows.map(mapRowToPermission);
  }

  /** Whether a matching standing grant exists for this tool/command. */
  isAllowed(projectPath: string | undefined, tool: string, command: string): boolean {
    const global = db
      .prepare("SELECT 1 FROM permissions WHERE scope = 'global' AND tool = ? AND command = ? AND status = 'allowed'")
      .get(tool, command);
    if (global) return true;

    if (projectPath) {
      const project = db
        .prepare("SELECT 1 FROM permissions WHERE scope = 'project' AND project_path = ? AND tool = ? AND command = ? AND status = 'allowed'")
        .get(projectPath, tool, command);
      if (project) return true;
    }
    return false;
  }

  allowProject(projectPath: string, tool: string, command: string): void {
    db.prepare(`
      INSERT OR REPLACE INTO permissions (scope, project_path, tool, command, status)
      VALUES ('project', ?, ?, ?, 'allowed')
    `).run(projectPath, tool, command);
  }

  allowGlobal(tool: string, command: string): void {
    db.prepare(`
      INSERT OR REPLACE INTO permissions (scope, project_path, tool, command, status)
      VALUES ('global', '', ?, ?, 'allowed')
    `).run(tool, command);
  }

  deleteById(id: number): boolean {
    const info = db.prepare("DELETE FROM permissions WHERE id = ?").run(id);
    return info.changes > 0;
  }

  clear(): void {
    db.prepare("DELETE FROM permissions").run();
  }
}

