import { DatabaseSync } from "node:sqlite";
import type { Project } from "@locagens/shared";
import { runDbWrite } from "../db.js";
import type { IProjectRepository } from "./interfaces.js";

function mapRowToProject(row: any): Project {
  return {
    path: row.path,
    name: row.name,
    createdAt: row.created_at
  };
}

export class ProjectRepository implements IProjectRepository {
  constructor(private db: DatabaseSync) {}

  async create(project: Project): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO projects (path, name, created_at)
      VALUES (?, ?, ?)
    `);
    await runDbWrite({ op: "project.create", args: { project } }, () => stmt.run(project.path, project.name, project.createdAt));
  }

  list(): Project[] {
    const stmt = this.db.prepare("SELECT * FROM projects ORDER BY created_at ASC");
    const rows = stmt.all() as any[];
    return rows.map(mapRowToProject);
  }

  async delete(path: string): Promise<void> {
    const stmt = this.db.prepare("DELETE FROM projects WHERE path = ?");
    await runDbWrite({ op: "project.delete", args: { path } }, () => stmt.run(path));
  }

  get(path: string): Project | null {
    const stmt = this.db.prepare("SELECT * FROM projects WHERE path = ?");
    const row = stmt.get(path) as any;
    return row ? mapRowToProject(row) : null;
  }
}
