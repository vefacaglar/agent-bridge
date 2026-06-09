import type { Run, RunMessage, RunStatus, Project, PermissionRule, Plan, PlanTask, Memory, MemoryScope, MemoryCategory, UsageLog } from "@agent-bridge/shared";
import { db, runDbWrite } from "./db.js";


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
    reasoningEffort: row.reasoning_effort || undefined,
    mode: row.mode || "accept_edits",
    coderProviderId: row.coder_provider_id || undefined,
    coderModel: row.coder_model || undefined,
    coderReasoningEffort: row.coder_reasoning_effort || undefined,
    utilityProviderId: row.utility_provider_id || undefined,
    utilityModel: row.utility_model || undefined,
    utilityReasoningEffort: row.utility_reasoning_effort || undefined,
    agentPreset: row.agent_preset || undefined,
    errorMessage: row.error_message || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at || undefined
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
  async create(run: Run): Promise<void> {
    const stmt = db.prepare(`
      INSERT INTO runs (
        id, title, task, project_path, project_name, status,
        provider_id, provider_display_name, model, reasoning_effort, mode,
        coder_provider_id, coder_model, coder_reasoning_effort, agent_preset,
        utility_provider_id, utility_model, utility_reasoning_effort,
        error_message, created_at, updated_at, last_active_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    await runDbWrite({ op: "run.create", args: { run } }, () => stmt.run(
      run.id,
      run.title,
      run.task,
      run.projectPath || process.cwd(),
      run.projectName || "Workspace",
      run.status,
      run.providerId,
      run.providerDisplayName,
      run.model,
      run.reasoningEffort || null,
      run.mode || "accept_edits",
      run.coderProviderId || null,
      run.coderModel || null,
      run.coderReasoningEffort || null,
      run.agentPreset || null,
      run.utilityProviderId || null,
      run.utilityModel || null,
      run.utilityReasoningEffort || null,
      run.errorMessage || null,
      run.createdAt,
      run.updatedAt,
      run.lastActiveAt || run.createdAt
    ));
  }

  getById(id: string): Run | null {
    const stmt = db.prepare("SELECT * FROM runs WHERE id = ?");
    const row = stmt.get(id) as any;
    return row ? mapRowToRun(row) : null;
  }

  list(): Run[] {
    const stmt = db.prepare("SELECT * FROM runs ORDER BY last_active_at DESC");
    const rows = stmt.all() as any[];
    return rows.map(mapRowToRun);
  }

  async update(id: string, updates: Partial<Run>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    const updatedAt = updates.updatedAt ?? new Date().toISOString();
    const writerUpdates = { ...updates, updatedAt };

    const mappings: Record<string, string> = {
      title: "title",
      task: "task",
      projectPath: "project_path",
      projectName: "project_name",
      status: "status",
      providerId: "provider_id",
      providerDisplayName: "provider_display_name",
      model: "model",
      reasoningEffort: "reasoning_effort",
      mode: "mode",
      coderProviderId: "coder_provider_id",
      coderModel: "coder_model",
      coderReasoningEffort: "coder_reasoning_effort",
      utilityProviderId: "utility_provider_id",
      utilityModel: "utility_model",
      utilityReasoningEffort: "utility_reasoning_effort",
      agentPreset: "agent_preset",
      errorMessage: "error_message",
      createdAt: "created_at",
      lastActiveAt: "last_active_at"
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
    fields.push("updated_at = ?");
    values.push(updatedAt);

    const sql = `UPDATE runs SET ${fields.join(", ")} WHERE id = ?`;
    values.push(id);

    const stmt = db.prepare(sql);
    await runDbWrite({ op: "run.update", args: { id, updates: writerUpdates } }, () => stmt.run(...values));
  }
}

export class MessageRepository {
  async create(message: RunMessage): Promise<void> {
    const stmt = db.prepare(`
      INSERT INTO messages (
        id, run_id, role, agent_role, agent_name,
        provider_id, provider_display_name, model,
        content, reasoning_content, raw_response, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateRunStmt = db.prepare("UPDATE runs SET updated_at = ?, last_active_at = ? WHERE id = ?");

    await runDbWrite({ op: "message.create", args: { message } }, () => {
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
      updateRunStmt.run(message.createdAt, message.createdAt, message.runId);
    });
  }

  listByRunId(runId: string): RunMessage[] {
    const stmt = db.prepare("SELECT * FROM messages WHERE run_id = ? ORDER BY created_at ASC");
    const rows = stmt.all(runId) as any[];
    return rows.map(mapRowToMessage);
  }

  async update(id: string, updates: Partial<RunMessage>): Promise<void> {
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
    await runDbWrite({ op: "message.update", args: { id, updates } }, () => stmt.run(...values));
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
      }, () => db.prepare(`
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
      await runDbWrite({ op: "plan.complete", args: { id: existing.id, updatedAt: now } }, () => db.prepare("UPDATE plans SET status = 'completed', updated_at = ? WHERE id = ?").run(now, existing.id));
    }

    const id = `plan-${runId}-${Date.now()}`;
    const version = existing ? existing.version + 1 : 1;
    await runDbWrite({ op: "plan.create", args: { id, runId, title: input.title?.trim() || "Plan", body: input.body ?? null, tasksJson, version, now } }, () => db.prepare(`
      INSERT INTO plans (id, run_id, title, body, tasks, status, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, runId, input.title?.trim() || "Plan", input.body ?? null, tasksJson, version, now, now));

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
  async create(project: Project): Promise<void> {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO projects (path, name, created_at)
      VALUES (?, ?, ?)
    `);
    await runDbWrite({ op: "project.create", args: { project } }, () => stmt.run(project.path, project.name, project.createdAt));
  }

  list(): Project[] {
    const stmt = db.prepare("SELECT * FROM projects ORDER BY created_at ASC");
    const rows = stmt.all() as any[];
    return rows.map(mapRowToProject);
  }

  async delete(path: string): Promise<void> {
    const stmt = db.prepare("DELETE FROM projects WHERE path = ?");
    await runDbWrite({ op: "project.delete", args: { path } }, () => stmt.run(path));
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

  async allowProject(projectPath: string, tool: string, command: string): Promise<void> {
    await runDbWrite({ op: "permission.allowProject", args: { projectPath, tool, command } }, () => db.prepare(`
      INSERT OR REPLACE INTO permissions (scope, project_path, tool, command, status)
      VALUES ('project', ?, ?, ?, 'allowed')
    `).run(projectPath, tool, command));
  }

  async allowGlobal(tool: string, command: string): Promise<void> {
    await runDbWrite({ op: "permission.allowGlobal", args: { tool, command } }, () => db.prepare(`
      INSERT OR REPLACE INTO permissions (scope, project_path, tool, command, status)
      VALUES ('global', '', ?, ?, 'allowed')
    `).run(tool, command));
  }

  async deleteById(id: number): Promise<boolean> {
    const info = await runDbWrite<{ changes: number | bigint }>({ op: "permission.deleteById", args: { id } }, () => db.prepare("DELETE FROM permissions WHERE id = ?").run(id));
    return Number(info.changes) > 0;
  }

  async clear(): Promise<void> {
    await runDbWrite({ op: "permission.clear" }, () => db.prepare("DELETE FROM permissions").run());
  }
}

const MEMORY_CATEGORIES: MemoryCategory[] = ["user", "feedback", "project", "reference"];

function mapRowToMemory(row: any): Memory {
  return {
    id: row.id,
    scope: row.scope === "global" ? "global" : "project",
    projectPath: row.project_path || "",
    category: MEMORY_CATEGORIES.includes(row.category) ? row.category : "project",
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface MemoryInput {
  scope: MemoryScope;
  projectPath: string;  // ignored for global scope (stored as "")
  category: MemoryCategory;
  content: string;
}

export class MemoryRepository {
  /** Every memory, newest first — used by the Settings management view. */
  list(): Memory[] {
    const rows = db.prepare("SELECT * FROM memory ORDER BY scope, project_path, created_at DESC").all() as any[];
    return rows.map(mapRowToMemory);
  }

  /**
   * The memories relevant to a run in the given project: all global memories
   * plus the project-scoped ones for that path. Injected into the run's prompt.
   */
  listForContext(projectPath: string | undefined): Memory[] {
    const rows = projectPath
      ? db.prepare(
          "SELECT * FROM memory WHERE scope = 'global' OR (scope = 'project' AND project_path = ?) ORDER BY scope DESC, created_at ASC"
        ).all(projectPath) as any[]
      : db.prepare("SELECT * FROM memory WHERE scope = 'global' ORDER BY created_at ASC").all() as any[];
    return rows.map(mapRowToMemory);
  }

  async create(input: MemoryInput): Promise<Memory> {
    const now = new Date().toISOString();
    const scope: MemoryScope = input.scope === "global" ? "global" : "project";
    const projectPath = scope === "global" ? "" : (input.projectPath || "");
    const category: MemoryCategory = MEMORY_CATEGORIES.includes(input.category) ? input.category : "project";
    const info = await runDbWrite<{ lastInsertRowid: number | bigint }>({ op: "memory.create", args: { scope, projectPath, category, content: input.content.trim(), now } }, () => db.prepare(`
      INSERT INTO memory (scope, project_path, category, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(scope, projectPath, category, input.content.trim(), now, now));
    return this.getById(Number(info.lastInsertRowid))!;
  }

  async update(id: number, content: string): Promise<Memory | null> {
    const now = new Date().toISOString();
    const info = await runDbWrite<{ changes: number | bigint }>({ op: "memory.update", args: { id, content: content.trim(), now } }, () => db.prepare("UPDATE memory SET content = ?, updated_at = ? WHERE id = ?").run(content.trim(), now, id));
    if (Number(info.changes) === 0) return null;
    return this.getById(id);
  }

  getById(id: number): Memory | null {
    const row = db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as any;
    return row ? mapRowToMemory(row) : null;
  }

  async deleteById(id: number): Promise<boolean> {
    const info = await runDbWrite<{ changes: number | bigint }>({ op: "memory.deleteById", args: { id } }, () => db.prepare("DELETE FROM memory WHERE id = ?").run(id));
    return Number(info.changes) > 0;
  }

  async clear(): Promise<void> {
    await runDbWrite({ op: "memory.clear" }, () => db.prepare("DELETE FROM memory").run());
  }
}

export class UsageLogRepository {
  async create(log: UsageLog): Promise<void> {
    const stmt = db.prepare(`
      INSERT INTO usage_logs (
        run_id, agent_role, provider_id, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        cache_hit_rate, cost, created_at, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    await runDbWrite({ op: "usage_logs.create", args: { log } }, () => stmt.run(
      log.runId,
      log.agentRole || null,
      log.providerId,
      log.model,
      log.inputTokens,
      log.outputTokens,
      log.cacheReadTokens,
      log.cacheWriteTokens,
      log.cacheHitRate,
      log.cost,
      log.createdAt,
      log.durationMs !== undefined ? log.durationMs : null
    ));
  }

  listByRunId(runId: string): UsageLog[] {
    const stmt = db.prepare("SELECT * FROM usage_logs WHERE run_id = ? ORDER BY created_at ASC");
    const rows = stmt.all(runId) as any[];
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      agentRole: row.agent_role || undefined,
      providerId: row.provider_id,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      cacheHitRate: row.cache_hit_rate,
      cost: row.cost,
      createdAt: row.created_at,
      durationMs: row.duration_ms || undefined
    }));
  }

  listAll(): UsageLog[] {
    const stmt = db.prepare("SELECT * FROM usage_logs ORDER BY created_at DESC");
    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      agentRole: row.agent_role || undefined,
      providerId: row.provider_id,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      cacheHitRate: row.cache_hit_rate,
      cost: row.cost,
      createdAt: row.created_at,
      durationMs: row.duration_ms || undefined
    }));
  }
}

