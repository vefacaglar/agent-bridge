import { DatabaseSync } from "node:sqlite";
import type { Memory, MemoryScope, MemoryCategory } from "@agent-bridge/shared";
import { runDbWrite } from "../db.js";
import type { IMemoryRepository, MemoryInput } from "./interfaces.js";

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

export class MemoryRepository implements IMemoryRepository {
  constructor(private db: DatabaseSync) {}

  /** Every memory, newest first — used by the Settings management view. */
  list(): Memory[] {
    const rows = this.db.prepare("SELECT * FROM memory ORDER BY scope, project_path, created_at DESC").all() as any[];
    return rows.map(mapRowToMemory);
  }

  /**
   * The memories relevant to a run in the given project: all global memories
   * plus the project-scoped ones for that path. Injected into the run's prompt.
   */
  listForContext(projectPath: string | undefined): Memory[] {
    const rows = projectPath
      ? this.db.prepare(
          "SELECT * FROM memory WHERE scope = 'global' OR (scope = 'project' AND project_path = ?) ORDER BY scope DESC, created_at ASC"
        ).all(projectPath) as any[]
      : this.db.prepare("SELECT * FROM memory WHERE scope = 'global' ORDER BY created_at ASC").all() as any[];
    return rows.map(mapRowToMemory);
  }

  async create(input: MemoryInput): Promise<Memory> {
    const now = new Date().toISOString();
    const scope: MemoryScope = input.scope === "global" ? "global" : "project";
    const projectPath = scope === "global" ? "" : (input.projectPath || "");
    const category: MemoryCategory = MEMORY_CATEGORIES.includes(input.category) ? input.category : "project";
    const info = await runDbWrite<{ lastInsertRowid: number | bigint }>({ op: "memory.create", args: { scope, projectPath, category, content: input.content.trim(), now } }, () => this.db.prepare(`
      INSERT INTO memory (scope, project_path, category, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(scope, projectPath, category, input.content.trim(), now, now));
    return this.getById(Number(info.lastInsertRowid))!;
  }

  async update(id: number, content: string): Promise<Memory | null> {
    const now = new Date().toISOString();
    const info = await runDbWrite<{ changes: number | bigint }>({ op: "memory.update", args: { id, content: content.trim(), now } }, () => this.db.prepare("UPDATE memory SET content = ?, updated_at = ? WHERE id = ?").run(content.trim(), now, id));
    if (Number(info.changes) === 0) return null;
    return this.getById(id);
  }

  getById(id: number): Memory | null {
    const row = this.db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as any;
    return row ? mapRowToMemory(row) : null;
  }

  async deleteById(id: number): Promise<boolean> {
    const info = await runDbWrite<{ changes: number | bigint }>({ op: "memory.deleteById", args: { id } }, () => this.db.prepare("DELETE FROM memory WHERE id = ?").run(id));
    return Number(info.changes) > 0;
  }

  async clear(): Promise<void> {
    await runDbWrite({ op: "memory.clear" }, () => this.db.prepare("DELETE FROM memory").run());
  }
}
