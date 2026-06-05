import type { Run, RunMessage, RunStatus, Project } from "@bridgemind/shared";
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
    plannerProviderId: row.planner_provider_id,
    plannerProviderDisplayName: row.planner_provider_display_name,
    plannerModel: row.planner_model,
    coderProviderId: row.coder_provider_id,
    coderProviderDisplayName: row.coder_provider_display_name,
    coderModel: row.coder_model,
    maxRounds: Number(row.max_rounds),
    currentRound: Number(row.current_round),
    sourceRunId: row.source_run_id || undefined,
    retryType: row.retry_type || undefined,
    finalOutput: row.final_output || undefined,
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
    role: row.role as "system" | "user" | "assistant",
    agentRole: row.agent_role || undefined,
    providerId: row.provider_id || undefined,
    providerDisplayName: row.provider_display_name || undefined,
    model: row.model || undefined,
    content: row.content,
    rawResponse: row.raw_response || undefined,
    createdAt: row.created_at
  };
}

export class RunRepository {
  create(run: Run): void {
    const stmt = db.prepare(`
      INSERT INTO runs (
        id, title, task, project_path, project_name, status,
        planner_provider_id, planner_provider_display_name, planner_model,
        coder_provider_id, coder_provider_display_name, coder_model,
        max_rounds, current_round, source_run_id, retry_type,
        final_output, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      run.id,
      run.title,
      run.task,
      run.projectPath || process.cwd(),
      run.projectName || "Workspace",
      run.status,
      run.plannerProviderId,
      run.plannerProviderDisplayName,
      run.plannerModel,
      run.coderProviderId,
      run.coderProviderDisplayName,
      run.coderModel,
      run.maxRounds,
      run.currentRound,
      run.sourceRunId || null,
      run.retryType || null,
      run.finalOutput || null,
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
      plannerProviderId: "planner_provider_id",
      plannerProviderDisplayName: "planner_provider_display_name",
      plannerModel: "planner_model",
      coderProviderId: "coder_provider_id",
      coderProviderDisplayName: "coder_provider_display_name",
      coderModel: "coder_model",
      maxRounds: "max_rounds",
      currentRound: "current_round",
      sourceRunId: "source_run_id",
      retryType: "retry_type",
      finalOutput: "final_output",
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
        content, raw_response, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      message.rawResponse || null,
      message.createdAt
    );
  }

  listByRunId(runId: string): RunMessage[] {
    const stmt = db.prepare("SELECT * FROM messages WHERE run_id = ? ORDER BY created_at ASC");
    const rows = stmt.all(runId) as any[];
    return rows.map(mapRowToMessage);
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

