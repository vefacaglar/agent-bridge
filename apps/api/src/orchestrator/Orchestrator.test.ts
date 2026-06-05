import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert";
import { db } from "../database/db.js";

// Set test environment so db.ts uses :memory: database
process.env.NODE_ENV = "test";

import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { RunRepository, MessageRepository, PlanRepository } from "../database/repositories.js";
import { Orchestrator } from "./Orchestrator.js";
import { eventBus } from "./eventBus.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import type { Run, RunStatus } from "@agent-bridge/shared";

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
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository());

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
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository());

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

  await t.test("Orchestrator - injects mode instructions into system prompt", async () => {
    const registry = new ProviderRegistry(testConfigPath);
    const runRepo = new RunRepository();
    const messageRepo = new MessageRepository();
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository());

    const runId = "run-test-mode-prompt";
    const runData: Run = {
      id: runId,
      title: "Test Mode task",
      task: "Tell me a plan",
      status: "created",
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      model: "model-1",
      mode: "plan",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    runRepo.create(runData);

    let systemPromptUsed = "";
    globalThis.fetch = async (url: any, options: any) => {
      const parsed = JSON.parse(options.body);
      const systemMessage = parsed.messages.find((m: any) => m.role === "system");
      if (systemMessage) {
        systemPromptUsed = systemMessage.content;
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: "I suggest plan A." } }]
        })
      } as any;
    };

    await orchestrator.run(runId);

    // Verify mode system prompt addition was present
    assert.ok(systemPromptUsed.includes("CURRENT OPERATIONAL MODE: PLAN MODE"));
    assert.ok(systemPromptUsed.includes("DO NOT call any file-mutating tools"));
    assert.ok(systemPromptUsed.includes("Do NOT implement"));
    assert.ok(systemPromptUsed.includes("Do NOT write production code"));
    assert.ok(systemPromptUsed.includes("do not treat repeated or pasted plan text as approval"));
    assert.ok(systemPromptUsed.includes("INITIAL PROJECT GUIDANCE"));
    assert.ok(systemPromptUsed.includes("Agents.md"));
    assert.ok(systemPromptUsed.includes("Claude.md"));
  });

  await t.test("System prompt - does not inject project guidance in chat mode", () => {
    const prompt = buildSystemPrompt("Test Project", "/tmp/test-project", "chat", true);

    assert.ok(prompt.includes("CURRENT OPERATIONAL MODE: CHAT MODE"));
    assert.ok(!prompt.includes("INITIAL PROJECT GUIDANCE"));
    assert.ok(!prompt.includes("Before doing substantive planning or implementation"));
  });

  await t.test("Orchestrator - pauses for permissions in ask_permissions mode and resumes on approval", async () => {
    const registry = new ProviderRegistry(testConfigPath);
    const runRepo = new RunRepository();
    const messageRepo = new MessageRepository();
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository());

    const runId = "run-test-perm-ask";
    const runData: Run = {
      id: runId,
      title: "Test Perm Task",
      task: "Create a file",
      status: "created",
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      model: "model-1",
      mode: "ask_permissions",
      projectPath: process.cwd(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    runRepo.create(runData);

    const createdFilePath = path.join(process.cwd(), "test_perm_file.json");
    t.after(() => {
      if (fs.existsSync(createdFilePath)) {
        fs.unlinkSync(createdFilePath);
      }
      db.exec("DELETE FROM permissions");
    });

    let callCount = 0;
    globalThis.fetch = async (url: any, options: any) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant",
                content: "Proposing a tool call",
                tool_calls: [{
                  id: "call_perm_1",
                  type: "function",
                  function: {
                    name: "write_file",
                    arguments: JSON.stringify({ path: "test_perm_file.json", content: "{}" })
                  }
                }]
              }
            }]
          })
        } as any;
      } else {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { role: "assistant", content: "File created successfully." } }]
          })
        } as any;
      }
    };

    const runPromise = orchestrator.run(runId);

    // Wait for the async task loop to process and hit the permission request wait point
    await new Promise(r => setTimeout(r, 100));

    const pendingRun = runRepo.getById(runId);
    assert.strictEqual(pendingRun?.status, "awaiting_permission");

    // Resolve decision as allow_once
    const resolved = orchestrator.resolvePermission(runId, "allow_once");
    assert.ok(resolved);

    await runPromise;

    const finishedRun = runRepo.getById(runId);
    assert.strictEqual(finishedRun?.status, "done");
    assert.ok(fs.existsSync(createdFilePath));
  });

  await t.test("Orchestrator - runs tool call read_file and list_directory successfully", async () => {
    const registry = new ProviderRegistry(testConfigPath);
    const runRepo = new RunRepository();
    const messageRepo = new MessageRepository();
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository());

    const runId = "run-test-read-list";
    const tempDir = path.join(process.cwd(), "temp_test_dir");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    const tempJsonPath = path.join(tempDir, "test_read_temp.json");
    fs.writeFileSync(tempJsonPath, '{"status": "ok"}', "utf-8");

    const runData: Run = {
      id: runId,
      title: "Test Read List Task",
      task: "Read index.json and list current dir",
      status: "created",
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      model: "model-1",
      projectPath: tempDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    runRepo.create(runData);

    t.after(() => {
      if (fs.existsSync(tempJsonPath)) {
        fs.unlinkSync(tempJsonPath);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    });

    let callCount = 0;
    globalThis.fetch = async (url: any, options: any) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant",
                content: "Reading file and listing directory...",
                tool_calls: [
                  {
                    id: "call_read_1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: JSON.stringify({ path: "test_read_temp.json" })
                    }
                  },
                  {
                    id: "call_list_1",
                    type: "function",
                    function: {
                      name: "list_directory",
                      arguments: JSON.stringify({ path: "" })
                    }
                  }
                ]
              }
            }]
          })
        } as any;
      } else {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { role: "assistant", content: "Completed read and list." } }]
          })
        } as any;
      }
    };

    await orchestrator.run(runId);

    // Verify database record has done status
    const finishedRun = runRepo.getById(runId);
    assert.strictEqual(finishedRun?.status, "done");

    // Verify messages saved (1 assistant tools, 2 tool outputs, 1 final assistant text response)
    const savedMsgs = messageRepo.listByRunId(runId);
    assert.strictEqual(savedMsgs.length, 4);
    assert.strictEqual(savedMsgs[0].role, "assistant");
    
    // Parse read_file response
    const readResponse = JSON.parse(savedMsgs[1].content);
    assert.strictEqual(readResponse.success, true);
    assert.strictEqual(readResponse.content, '{"status": "ok"}');

    // Parse list_directory response
    const listResponse = JSON.parse(savedMsgs[2].content);
    assert.strictEqual(listResponse.success, true);
    assert.ok(listResponse.files.some((f: any) => f.name === 'test_read_temp.json'));
    
    assert.strictEqual(savedMsgs[3].role, "assistant");
  });
});
