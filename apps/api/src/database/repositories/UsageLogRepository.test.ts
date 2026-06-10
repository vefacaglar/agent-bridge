import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { UsageLogRepository } from "./UsageLogRepository.js";

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      agent_role TEXT,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cache_hit_rate REAL NOT NULL DEFAULT 0.0,
      cost REAL NOT NULL DEFAULT 0.0,
      created_at TEXT NOT NULL,
      duration_ms INTEGER
    );
  `);
  return db;
}

function insert(db: DatabaseSync, runId: string, agentRole: string | null, cost: number, input: number, output: number, cacheRead = 0) {
  db.prepare(`
    INSERT INTO usage_logs (run_id, agent_role, provider_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cache_hit_rate, cost, created_at)
    VALUES (?, ?, 'p1', 'm1', ?, ?, ?, 0, 0, ?, '2026-06-10T00:00:00Z')
  `).run(runId, agentRole, input, output, cacheRead, cost);
}

test("getRunSummary aggregates totals and groups by agent role", () => {
  const db = makeDb();
  insert(db, "run-1", "main", 0.10, 1000, 200, 4000);
  insert(db, "run-1", "main", 0.05, 500, 100, 0);
  insert(db, "run-1", "coder", 0.02, 2000, 800, 0);
  insert(db, "run-2", "main", 9.99, 99, 99, 0); // other run must not bleed in

  const summary = new UsageLogRepository(db).getRunSummary("run-1");

  assert.equal(summary.runId, "run-1");
  assert.equal(summary.totalCalls, 3);
  assert.ok(Math.abs(summary.totalCost - 0.17) < 1e-9);
  assert.equal(summary.totalInputTokens, 3500);
  assert.equal(summary.totalOutputTokens, 1100);
  assert.equal(summary.totalCacheReadTokens, 4000);
  // 4000 cache-read of 7500 prompt tokens (3500 fresh + 4000 cached) = 53%.
  assert.equal(summary.avgCacheHitRate, 53);

  const roles = Object.fromEntries(summary.byRole.map(r => [r.agentRole, r]));
  assert.equal(roles.main.calls, 2);
  assert.equal(roles.coder.calls, 1);
  assert.equal(roles.coder.inputTokens, 2000);
});

test("getRunSummary maps null agent_role to 'main' and handles empty runs", () => {
  const db = makeDb();
  insert(db, "run-1", null, 0.01, 100, 50);

  const repo = new UsageLogRepository(db);
  const summary = repo.getRunSummary("run-1");
  assert.equal(summary.byRole.length, 1);
  assert.equal(summary.byRole[0].agentRole, "main");

  const empty = repo.getRunSummary("missing-run");
  assert.equal(empty.totalCalls, 0);
  assert.equal(empty.totalCost, 0);
  assert.equal(empty.avgCacheHitRate, 0);
  assert.deepEqual(empty.byRole, []);
});
