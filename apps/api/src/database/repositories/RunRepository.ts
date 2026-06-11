import { DatabaseSync } from "node:sqlite";
import type { Run, RunStatus } from "@locagens/shared";
import { runDbWrite } from "../db.js";
import type { IRunRepository } from "./interfaces.js";

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

export class RunRepository implements IRunRepository {
  constructor(private db: DatabaseSync) {}

  async create(run: Run): Promise<void> {
    const stmt = this.db.prepare(`
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
    const stmt = this.db.prepare("SELECT * FROM runs WHERE id = ?");
    const row = stmt.get(id) as any;
    return row ? mapRowToRun(row) : null;
  }

  list(): Run[] {
    const stmt = this.db.prepare("SELECT * FROM runs ORDER BY last_active_at DESC");
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

    const stmt = this.db.prepare(sql);
    await runDbWrite({ op: "run.update", args: { id, updates: writerUpdates } }, () => stmt.run(...values));
  }
}
