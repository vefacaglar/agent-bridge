import type { Run, RunMessage, RunStatus, Project, PermissionRule } from "@bridgemind/shared";
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
        error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        id, run_id, role, agent_role,
        provider_id, provider_display_name, model,
        content, reasoning_content, raw_response, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.id,
      message.runId,
      message.role,
      message.agentRole || null,
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

