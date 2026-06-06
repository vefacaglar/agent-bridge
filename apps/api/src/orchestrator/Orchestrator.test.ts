import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert";
import { db } from "../database/db.js";

// Set test environment so db.ts uses :memory: database
process.env.NODE_ENV = "test";

import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import { RunRepository, MessageRepository, PlanRepository, MemoryRepository } from "../database/repositories.js";
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
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository(), new MemoryRepository());

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
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository(), new MemoryRepository());

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
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository(), new MemoryRepository());

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
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository(), new MemoryRepository());

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
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository(), new MemoryRepository());

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

  await t.test("Orchestrator - delegate_tasks runs coder sub-agents sequentially", async () => {
    const registry = new ProviderRegistry(testConfigPath);
    const runRepo = new RunRepository();
    const messageRepo = new MessageRepository();
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository(), new MemoryRepository());

    const runId = "run-test-delegate";
    const runData: Run = {
      id: runId,
      title: "Test Delegate",
      task: "Build two things",
      status: "created",
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      model: "model-1",
      // Dual-model: architect + coder on the same mock provider.
      coderProviderId: "test-provider",
      coderModel: "model-1",
      projectPath: process.cwd(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    runRepo.create(runData);

    let callCount = 0;
    globalThis.fetch = async (_url: any, _options: any) => {
      callCount++;
      if (callCount === 1) {
        // Architect delegates two sub-tasks sequentially.
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant",
                content: "Delegating the work.",
                tool_calls: [{
                  id: "call_delegate_1",
                  type: "function",
                  function: {
                    name: "delegate_tasks",
                    arguments: JSON.stringify({
                      parallel: false,
                      tasks: [
                        { title: "Task A", instructions: "Do A" },
                        { title: "Task B", instructions: "Do B" }
                      ]
                    })
                  }
                }]
              }
            }]
          })
        } as any;
      }
      // Coder sub-agents (calls 2 and 3) and the architect's final turn (call 4)
      // all return a plain text answer with no further tool calls.
      const text = callCount === 2 ? "Coder finished A"
        : callCount === 3 ? "Coder finished B"
        : "All subtasks complete.";
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: text } }]
        })
      } as any;
    };

    await orchestrator.run(runId);

    const finishedRun = runRepo.getById(runId);
    assert.strictEqual(finishedRun?.status, "done");

    const savedMsgs = messageRepo.listByRunId(runId);
    // architect tool call, coder A, coder B, delegate tool result, architect final
    assert.strictEqual(savedMsgs.length, 5);
    assert.strictEqual(savedMsgs[0].agentRole, "planner");
    assert.ok(savedMsgs[0].rawResponse?.includes("delegate_tasks"));
    assert.strictEqual(savedMsgs[1].agentRole, "coder");
    assert.strictEqual(savedMsgs[1].content, "Coder finished A");
    assert.strictEqual(savedMsgs[2].agentRole, "coder");
    assert.strictEqual(savedMsgs[2].content, "Coder finished B");
    assert.strictEqual(savedMsgs[3].role, "tool");

    const delegateResult = JSON.parse(savedMsgs[3].content);
    assert.strictEqual(delegateResult.success, true);
    assert.strictEqual(delegateResult.parallel, false);
    assert.strictEqual(delegateResult.results.length, 2);
    assert.strictEqual(delegateResult.results[0].summary, "Coder finished A");

    assert.strictEqual(savedMsgs[4].content, "All subtasks complete.");
  });

  await t.test("Orchestrator - delegate_to_utility runs a utility sub-agent", async () => {
    const registry = new ProviderRegistry(testConfigPath);
    const runRepo = new RunRepository();
    const messageRepo = new MessageRepository();
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository(), new MemoryRepository());

    const runId = "run-test-utility";
    const runData: Run = {
      id: runId,
      title: "Test Utility",
      task: "Find a file then build",
      status: "created",
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      model: "model-1",
      // Dual-model + utility tier, all on the same mock provider.
      coderProviderId: "test-provider",
      coderModel: "model-1",
      utilityProviderId: "test-provider",
      utilityModel: "model-1",
      projectPath: process.cwd(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    runRepo.create(runData);

    let callCount = 0;
    globalThis.fetch = async (_url: any, _options: any) => {
      callCount++;
      if (callCount === 1) {
        // Architect delegates one tiny lookup to the utility tier.
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant",
                content: "Let me locate it.",
                tool_calls: [{
                  id: "call_util_1",
                  type: "function",
                  function: {
                    name: "delegate_to_utility",
                    arguments: JSON.stringify({
                      tasks: [{ title: "Locate config", instructions: "Where is config defined?" }]
                    })
                  }
                }]
              }
            }]
          })
        } as any;
      }
      // Utility sub-agent (call 2) returns a short answer; architect final (call 3).
      const text = callCount === 2 ? "It's at src/config.ts:10" : "Done.";
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { role: "assistant", content: text } }]
        })
      } as any;
    };

    await orchestrator.run(runId);

    const finishedRun = runRepo.getById(runId);
    assert.strictEqual(finishedRun?.status, "done");

    const savedMsgs = messageRepo.listByRunId(runId);
    // architect tool call, utility sub-agent, utility tool result, architect final
    assert.strictEqual(savedMsgs.length, 4);
    assert.ok(savedMsgs[0].rawResponse?.includes("delegate_to_utility"));
    assert.strictEqual(savedMsgs[1].agentRole, "utility");
    assert.strictEqual(savedMsgs[1].agentName, "Locate config");
    assert.strictEqual(savedMsgs[1].content, "It's at src/config.ts:10");
    assert.strictEqual(savedMsgs[2].role, "tool");

    const utilResult = JSON.parse(savedMsgs[2].content);
    assert.strictEqual(utilResult.success, true);
    assert.strictEqual(utilResult.results.length, 1);
    assert.strictEqual(utilResult.results[0].summary, "It's at src/config.ts:10");

    assert.strictEqual(savedMsgs[3].content, "Done.");
  });

  await t.test("Orchestrator - plan mode blocks mutating/command tools even if the model calls them", async () => {
    const registry = new ProviderRegistry(testConfigPath);
    const runRepo = new RunRepository();
    const messageRepo = new MessageRepository();
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository(), new MemoryRepository());

    const runId = "run-test-plan-block";
    const blockedFilePath = path.join(process.cwd(), "test_plan_blocked.json");
    t.after(() => {
      if (fs.existsSync(blockedFilePath)) fs.unlinkSync(blockedFilePath);
    });

    runRepo.create({
      id: runId,
      title: "Plan block",
      task: "Plan only",
      status: "created",
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      model: "model-1",
      mode: "plan",
      projectPath: process.cwd(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const statusesEmitted: RunStatus[] = [];
    const listener = (event: any) => {
      if (event.type === "status_changed") statusesEmitted.push(event.status);
    };
    eventBus.on(`run:${runId}`, listener);
    t.after(() => eventBus.off(`run:${runId}`, listener));

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        // Model (mis)behaves: tries to write a file while in plan mode.
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant",
                content: "Writing file",
                tool_calls: [{
                  id: "call_plan_write",
                  type: "function",
                  function: { name: "write_file", arguments: JSON.stringify({ path: "test_plan_blocked.json", content: "{}" }) }
                }]
              }
            }]
          })
        } as any;
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { role: "assistant", content: "Understood, staying in plan mode." } }] })
      } as any;
    };

    await orchestrator.run(runId);

    // The file must NOT have been created, and no permission prompt should occur.
    assert.ok(!fs.existsSync(blockedFilePath), "plan mode must not create files");
    assert.ok(!statusesEmitted.includes("awaiting_permission"), "plan mode must not even prompt for permission");

    const savedMsgs = messageRepo.listByRunId(runId);
    const toolMsg = savedMsgs.find(m => m.role === "tool");
    assert.ok(toolMsg);
    const result = JSON.parse(toolMsg!.content);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Plan mode/);
  });

  await t.test("Orchestrator - delegate_tasks clamps to at most 3 sub-agents", async () => {
    const registry = new ProviderRegistry(testConfigPath);
    const runRepo = new RunRepository();
    const messageRepo = new MessageRepository();
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository(), new MemoryRepository());

    const runId = "run-test-delegate-clamp";
    runRepo.create({
      id: runId,
      title: "Clamp",
      task: "Too many",
      status: "created",
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      model: "model-1",
      coderProviderId: "test-provider",
      coderModel: "model-1",
      projectPath: process.cwd(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant",
                content: "Delegating five tasks.",
                tool_calls: [{
                  id: "call_delegate_clamp",
                  type: "function",
                  function: {
                    name: "delegate_tasks",
                    arguments: JSON.stringify({
                      parallel: false,
                      tasks: [1, 2, 3, 4, 5].map(n => ({ title: `T${n}`, instructions: `Do ${n}` }))
                    })
                  }
                }]
              }
            }]
          })
        } as any;
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { role: "assistant", content: "ok" } }] })
      } as any;
    };

    await orchestrator.run(runId);

    const savedMsgs = messageRepo.listByRunId(runId);
    const toolMsg = savedMsgs.find(m => m.role === "tool");
    assert.ok(toolMsg);
    const result = JSON.parse(toolMsg!.content);
    assert.strictEqual(result.results.length, 3, "should clamp 5 requested tasks to 3");
  });

  await t.test("Orchestrator - remember saves a memory and later runs inject it", async () => {
    const registry = new ProviderRegistry(testConfigPath);
    const runRepo = new RunRepository();
    const messageRepo = new MessageRepository();
    const memoryRepo = new MemoryRepository();
    const orchestrator = new Orchestrator(runRepo, messageRepo, registry, new PlanRepository(), memoryRepo);

    const projectPath = process.cwd();
    const runId = "run-test-remember";
    runRepo.create({
      id: runId,
      title: "Remember",
      task: "I always want 2-space indentation",
      status: "created",
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      model: "model-1",
      mode: "accept_edits",
      projectPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: "assistant",
                content: "Noting your preference.",
                tool_calls: [{
                  id: "call_remember_1",
                  type: "function",
                  function: {
                    name: "remember",
                    arguments: JSON.stringify({
                      scope: "global",
                      category: "user",
                      content: "Prefers 2-space indentation."
                    })
                  }
                }]
              }
            }]
          })
        } as any;
      }
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { role: "assistant", content: "Done." } }] })
      } as any;
    };

    await orchestrator.run(runId);

    // The memory was persisted (silently, no permission prompt).
    const all = memoryRepo.list();
    const saved = all.find(m => m.content === "Prefers 2-space indentation.");
    assert.ok(saved, "memory should be saved");
    assert.strictEqual(saved!.scope, "global");
    assert.strictEqual(saved!.category, "user");

    // The remember tool result reported success.
    const toolMsg = messageRepo.listByRunId(runId).find(m => m.role === "tool");
    assert.ok(toolMsg);
    assert.strictEqual(JSON.parse(toolMsg!.content).success, true);

    // A subsequent run injects the memory into the system prompt.
    const run2Id = "run-test-remember-2";
    runRepo.create({
      id: run2Id,
      title: "Next session",
      task: "Write some code",
      status: "created",
      providerId: "test-provider",
      providerDisplayName: "Test Provider",
      model: "model-1",
      mode: "accept_edits",
      projectPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    let systemPromptUsed = "";
    globalThis.fetch = async (_url: any, options: any) => {
      const parsed = JSON.parse(options.body);
      const systemMessage = parsed.messages.find((m: any) => m.role === "system");
      if (systemMessage) systemPromptUsed = systemMessage.content;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { role: "assistant", content: "ok" } }] })
      } as any;
    };

    await orchestrator.run(run2Id);

    assert.ok(systemPromptUsed.includes("REMEMBERED CONTEXT"));
    assert.ok(systemPromptUsed.includes("Prefers 2-space indentation."));
  });
});
