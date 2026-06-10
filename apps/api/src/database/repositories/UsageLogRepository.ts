import { DatabaseSync } from "node:sqlite";
import type { UsageLog, PaginatedUsageLogs, RunUsageSummary } from "@agent-bridge/shared";
import { runDbWrite } from "../db.js";
import type { IUsageLogRepository } from "./interfaces.js";

export class UsageLogRepository implements IUsageLogRepository {
  constructor(private db: DatabaseSync) {}

  async create(log: UsageLog): Promise<void> {
    const stmt = this.db.prepare(`
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
    const stmt = this.db.prepare("SELECT * FROM usage_logs WHERE run_id = ? ORDER BY created_at ASC");
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
    const stmt = this.db.prepare("SELECT * FROM usage_logs ORDER BY created_at DESC");
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

  getPaginated(params: {
    limit: number;
    offset: number;
    search?: string;
    providerId?: string;
    agentRole?: string;
  }): PaginatedUsageLogs {
    const whereClauses: string[] = [];
    const queryParams: any[] = [];

    if (params.providerId) {
      whereClauses.push("provider_id = ?");
      queryParams.push(params.providerId);
    }

    if (params.agentRole) {
      whereClauses.push("agent_role = ?");
      queryParams.push(params.agentRole);
    }

    if (params.search) {
      whereClauses.push("(run_id LIKE ? OR model LIKE ?)");
      const term = `%${params.search.trim()}%`;
      queryParams.push(term, term);
    }

    const whereSql = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

    // 1. Paginated query
    const selectSql = `SELECT * FROM usage_logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(selectSql).all(...queryParams, params.limit, params.offset) as any[];
    const logs = rows.map((row) => ({
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

    // 2. Count query
    const countSql = `SELECT COUNT(*) as total FROM usage_logs ${whereSql}`;
    const totalRow = this.db.prepare(countSql).get(...queryParams) as any;
    const total = totalRow ? totalRow.total : 0;

    // 3. Dropdown helpers - Unfiltered unique values
    const providersRows = this.db.prepare("SELECT DISTINCT provider_id FROM usage_logs WHERE provider_id IS NOT NULL AND provider_id != ''").all() as any[];
    const uniqueProviders = providersRows.map((row) => row.provider_id).sort();

    const rolesRows = this.db.prepare("SELECT DISTINCT agent_role FROM usage_logs WHERE agent_role IS NOT NULL AND agent_role != ''").all() as any[];
    const uniqueRoles = rolesRows.map((row) => row.agent_role).sort();

    // 4. Overall metrics - Unfiltered
    const metricsRow = this.db.prepare(`
      SELECT 
        SUM(cost) as totalCost, 
        COUNT(*) as totalCalls, 
        SUM(input_tokens + output_tokens + COALESCE(cache_read_tokens, 0)) as totalTokens,
        SUM(input_tokens + COALESCE(cache_read_tokens, 0)) as totalPromptTokens,
        SUM(COALESCE(cache_read_tokens, 0)) as totalCacheReadTokens
      FROM usage_logs
    `).get() as any;

    const totalCost = metricsRow?.totalCost || 0;
    const totalCalls = metricsRow?.totalCalls || 0;
    const totalTokens = metricsRow?.totalTokens || 0;
    const totalPrompt = metricsRow?.totalPromptTokens || 0;
    const totalCacheRead = metricsRow?.totalCacheReadTokens || 0;
    const avgCacheHitRate = totalPrompt > 0 ? Math.round((totalCacheRead / totalPrompt) * 100) : 0;

    return {
      logs,
      total,
      uniqueProviders,
      uniqueRoles,
      metrics: {
        totalCost,
        totalCalls,
        totalTokens,
        avgCacheHitRate
      }
    };
  }

  getRunSummary(runId: string): RunUsageSummary {
    const rows = this.db.prepare(`
      SELECT
        COALESCE(agent_role, 'main') as agentRole,
        SUM(cost) as cost,
        COUNT(*) as calls,
        SUM(input_tokens) as inputTokens,
        SUM(output_tokens) as outputTokens,
        SUM(COALESCE(cache_read_tokens, 0)) as cacheReadTokens,
        SUM(input_tokens + COALESCE(cache_read_tokens, 0)) as promptTokens
      FROM usage_logs
      WHERE run_id = ?
      GROUP BY COALESCE(agent_role, 'main')
    `).all(runId) as any[];

    let totalCost = 0;
    let totalCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalPromptTokens = 0;

    const byRole = rows.map((row) => {
      totalCost += row.cost || 0;
      totalCalls += row.calls || 0;
      totalInputTokens += row.inputTokens || 0;
      totalOutputTokens += row.outputTokens || 0;
      totalCacheReadTokens += row.cacheReadTokens || 0;
      totalPromptTokens += row.promptTokens || 0;
      return {
        agentRole: row.agentRole,
        cost: row.cost || 0,
        calls: row.calls || 0,
        inputTokens: row.inputTokens || 0,
        outputTokens: row.outputTokens || 0
      };
    });

    return {
      runId,
      totalCost,
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      avgCacheHitRate: totalPromptTokens > 0 ? Math.round((totalCacheReadTokens / totalPromptTokens) * 100) : 0,
      byRole
    };
  }
}
