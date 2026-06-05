import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert";

// Set test environment so db.ts uses :memory: database
process.env.NODE_ENV = "test";

import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { RunRepository, MessageRepository } from "../database/repositories.js";
import { Orchestrator } from "./Orchestrator.js";
import { eventBus } from "./eventBus.js";
import type { Run, RunStatus } from "@bridgemind/shared";

// Mock config content
const mockConfig = {
  providers: {
    "test-provider": {
      type: "openai-compatible",
      displayName: "Test Provider",
      baseUrl: "http://localhost:9999/model",
      apiKey: "mock-key",
      models: ["model-1"]
    }
  }
};

test("Orchestrator Integration Tests", async (t) => {
  const testConfigPath = path.join(process.cwd(), "providers.orch-test.json");
  fs.writeFileSync(testConfigPath, JSON.stringify(mockConfig, null, 2));

  t.after(() => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  const originalFetch = globalThis.fetch;
  t.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("Orchestrator - runs single model completion", async () => {
    const registry = new ProviderRegistry(testConfigPath);
    const runRepo = new RunRepository();
    const messageRepo = new MessageRepository();
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry);

    const runId = "run-test-123";
    const runData: Run = {
      id: runId,
      title: "Test Task",
      task: "Hello model",
      status: "created",
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      model: "model-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    runRepo.create(runData);

    // Track status transitions via eventBus
    const statusesEmitted: RunStatus[] = [];
    const eventListener = (event: any) => {
      if (event.type === "status_changed") {
        statusesEmitted.push(event.status);
      }
    };
    eventBus.on(`run:${runId}`, eventListener);
    t.after(() => {
      eventBus.off(`run:${runId}`, eventListener);
    });

    // Mock fetch to simulate model response
    globalThis.fetch = async (url: any, options: any) => {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: "Hello back!" } }]
        })
      } as any;
    };

    // Trigger run execution
    await orchestrator.run(runId);

    // Verify database record has done status
    const finishedRun = runRepo.getById(runId);
    assert.ok(finishedRun);
    assert.strictEqual(finishedRun.status, "done");

    // Verify message saved
    const savedMsgs = messageRepo.listByRunId(runId);
    assert.strictEqual(savedMsgs.length, 1);
    assert.strictEqual(savedMsgs[0].content, "Hello back!");
    assert.strictEqual(savedMsgs[0].role, "assistant");

    // Assert correct state transitions sequence
    assert.deepStrictEqual(statusesEmitted, [
      "generating",
      "done"
    ]);
  });
});
