import { DatabaseSync } from "node:sqlite";
import type { PermissionRule } from "@locagens/shared";
import { runDbWrite } from "../db.js";
import type { IPermissionRepository } from "./interfaces.js";

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

export class PermissionRepository implements IPermissionRepository {
  constructor(private db: DatabaseSync) {}

  list(): PermissionRule[] {
    const rows = this.db.prepare("SELECT * FROM permissions ORDER BY scope, project_path, tool, command").all() as any[];
    return rows.map(mapRowToPermission);
  }

  /** Whether a matching standing grant exists for this tool/command. */
  isAllowed(projectPath: string | undefined, tool: string, command: string): boolean {
    const global = this.db
      .prepare("SELECT 1 FROM permissions WHERE scope = 'global' AND tool = ? AND command = ? AND status = 'allowed'")
      .get(tool, command);
    if (global) return true;

    if (projectPath) {
      const project = this.db
        .prepare("SELECT 1 FROM permissions WHERE scope = 'project' AND project_path = ? AND tool = ? AND command = ? AND status = 'allowed'")
        .get(projectPath, tool, command);
      if (project) return true;
    }
    return false;
  }

  async allowProject(projectPath: string, tool: string, command: string): Promise<void> {
    await runDbWrite({ op: "permission.allowProject", args: { projectPath, tool, command } }, () => this.db.prepare(`
      INSERT OR REPLACE INTO permissions (scope, project_path, tool, command, status)
      VALUES ('project', ?, ?, ?, 'allowed')
    `).run(projectPath, tool, command));
  }

  async allowGlobal(tool: string, command: string): Promise<void> {
    await runDbWrite({ op: "permission.allowGlobal", args: { tool, command } }, () => this.db.prepare(`
      INSERT OR REPLACE INTO permissions (scope, project_path, tool, command, status)
      VALUES ('global', '', ?, ?, 'allowed')
    `).run(tool, command));
  }

  async deleteById(id: number): Promise<boolean> {
    const info = await runDbWrite<{ changes: number | bigint }>({ op: "permission.deleteById", args: { id } }, () => this.db.prepare("DELETE FROM permissions WHERE id = ?").run(id));
    return Number(info.changes) > 0;
  }

  async clear(): Promise<void> {
    await runDbWrite({ op: "permission.clear" }, () => this.db.prepare("DELETE FROM permissions").run());
  }
}
