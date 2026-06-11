import { DatabaseSync } from "node:sqlite";
import type { RunMessage } from "@locagens/shared";
import { runDbWrite } from "../db.js";
import type { IMessageRepository } from "./interfaces.js";

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

export class MessageRepository implements IMessageRepository {
  constructor(private db: DatabaseSync) {}

  async create(message: RunMessage): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, run_id, role, agent_role, agent_name,
        provider_id, provider_display_name, model,
        content, reasoning_content, raw_response, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateRunStmt = this.db.prepare("UPDATE runs SET updated_at = ?, last_active_at = ? WHERE id = ?");

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
    const stmt = this.db.prepare("SELECT * FROM messages WHERE run_id = ? ORDER BY created_at ASC");
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

    const stmt = this.db.prepare(sql);
    await runDbWrite({ op: "message.update", args: { id, updates } }, () => stmt.run(...values));
  }
}
