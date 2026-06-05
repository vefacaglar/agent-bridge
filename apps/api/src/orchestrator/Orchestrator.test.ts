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

  await t.test("Orchestrator - runs tool call write_file and saves results", async () => {
    const registry = new ProviderRegistry(testConfigPath);
    const runRepo = new RunRepository();
    const messageRepo = new MessageRepository();
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry);

    const runId = "run-test-tool-call";
    const runData: Run = {
      id: runId,
      title: "Test Tool Call",
      task: "Create selam.json with {}",
      status: "created",
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      model: "model-1",
      projectPath: process.cwd(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    runRepo.create(runData);

    const createdFilePath = path.join(process.cwd(), "test_output_file.json");
    t.after(() => {
      if (fs.existsSync(createdFilePath)) {
        fs.unlinkSync(createdFilePath);
      }
    });

    let callCount = 0;
    globalThis.fetch = async (url: any, options: any) => {
      callCount++;
      if (callCount === 1) {
        // Return tool call
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant",
                content: "Sure, let me create the file.",
                tool_calls: [{
                  id: "call_test_1",
                  type: "function",
                  function: {
                    name: "write_file",
                    arguments: JSON.stringify({ path: "test_output_file.json", content: "{}" })
                  }
                }]
              }
            }]
          })
        } as any;
      } else {
        // Return text response after tool call is processed
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant",
                content: "I have successfully created the file."
              }
            }]
          })
        } as any;
      }
    };

    await orchestrator.run(runId);

    // Verify file is actually created
    assert.ok(fs.existsSync(createdFilePath));
    assert.strictEqual(fs.readFileSync(createdFilePath, "utf-8"), "{}");

    // Verify messages saved (1 assistant tools, 1 tool output, 1 final assistant text response)
    const savedMsgs = messageRepo.listByRunId(runId);
    assert.strictEqual(savedMsgs.length, 3);
    assert.strictEqual(savedMsgs[0].role, "assistant");
    assert.ok(savedMsgs[0].rawResponse?.includes("write_file"));
    assert.strictEqual(savedMsgs[1].role, "tool");
    assert.ok(savedMsgs[1].content.includes("success"));
    assert.strictEqual(savedMsgs[2].role, "assistant");
    assert.strictEqual(savedMsgs[2].content, "I have successfully created the file.");
  });
});
