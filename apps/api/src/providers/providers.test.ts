import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert";
import { PRESERVE_API_KEY_VALUE, ProviderRegistry } from "./ProviderRegistry.js";
import { InMemoryProviderSecretStore } from "./ProviderSecretStore.js";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider.js";
import { AnthropicProvider } from "./AnthropicProvider.js";

// Mock config content
const mockConfig = {
  providers: {
    "mock-openai": {
      type: "openai-compatible",
      displayName: "Mock OpenAI",
      baseUrl: "http://localhost:9999/openai",
      apiKey: "sk-mock-key-123",
      models: ["gpt-4o", "gpt-4-turbo"]
    },
    "mock-anthropic": {
      type: "anthropic",
      displayName: "Mock Anthropic",
      baseUrl: "http://localhost:9999/anthropic",
      apiKey: "ant-mock-key-456",
      models: ["claude-3-5-sonnet", "claude-3-opus"]
    }
  }
};

test("Provider Registry and Model Providers Unit Tests", async (t) => {
  const testConfigPath = path.join(process.cwd(), "providers.test-temp.json");
  const createRegistry = () => new ProviderRegistry(testConfigPath, new InMemoryProviderSecretStore());
  
  // Write mock config
  fs.writeFileSync(testConfigPath, JSON.stringify(mockConfig, null, 2));

  t.after(() => {
    // Cleanup mock config
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  const originalFetch = globalThis.fetch;
  t.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("ProviderRegistry - loads configuration correctly", () => {
    const registry = createRegistry();
    const safeMetadata = registry.getSafeMetadata();

    assert.strictEqual(safeMetadata.length, 2);
    
    const openAiMeta = safeMetadata.find(m => m.id === "mock-openai");
    assert.ok(openAiMeta);
    assert.strictEqual(openAiMeta.displayName, "Mock OpenAI");
    assert.strictEqual(openAiMeta.type, "openai-compatible");
    assert.deepStrictEqual(openAiMeta.models, ["gpt-4o", "gpt-4-turbo"]);
    // Confirm API key and base URL are not exposed in safe metadata
    assert.strictEqual((openAiMeta as any).apiKey, undefined);
    assert.strictEqual((openAiMeta as any).baseUrl, undefined);
  });

  await t.test("ProviderRegistry - instantiates and caches providers", () => {
    const registry = createRegistry();
    const provider1 = registry.getProvider("mock-openai");
    const provider2 = registry.getProvider("mock-openai");

    assert.ok(provider1 instanceof OpenAICompatibleProvider);
    // Registry should cache providers and return the exact same instance
    assert.strictEqual(provider1, provider2);

    const anthropicProvider = registry.getProvider("mock-anthropic");
    assert.ok(anthropicProvider instanceof AnthropicProvider);
  });

  await t.test("ProviderRegistry - editable config masks API keys", () => {
    const registry = createRegistry();
    const editableConfigs = registry.getEditableConfigs();

    assert.strictEqual(editableConfigs["mock-openai"].apiKey, PRESERVE_API_KEY_VALUE);
    assert.strictEqual(editableConfigs["mock-openai"].hasApiKey, true);
    assert.notStrictEqual((editableConfigs["mock-openai"] as any).apiKey, "sk-mock-key-123");
  });

  await t.test("ProviderRegistry - save preserves existing API key without persisting it inline", () => {
    const secretStore = new InMemoryProviderSecretStore();
    const registry = new ProviderRegistry(testConfigPath, secretStore);

    registry.saveConfigs({
      "mock-openai": {
        type: "openai-compatible",
        displayName: "Renamed OpenAI",
        baseUrl: "http://localhost:9999/openai",
        apiKey: PRESERVE_API_KEY_VALUE,
        models: ["gpt-4o"]
      }
    });

    const saved = JSON.parse(fs.readFileSync(testConfigPath, "utf-8"));
    assert.strictEqual(saved.providers["mock-openai"].apiKey, undefined);
    assert.strictEqual(saved.providers["mock-openai"].apiKeyRef, "memory:mock-openai");
    assert.strictEqual(secretStore.get(saved.providers["mock-openai"].apiKeyRef), "sk-mock-key-123");
    assert.strictEqual(saved.providers["mock-openai"].displayName, "Renamed OpenAI");
  });

  await t.test("ProviderRegistry - deleting all presets persists an explicit empty set", () => {
    const presetConfigPath = path.join(process.cwd(), "providers.presets-test-temp.json");
    fs.writeFileSync(
      presetConfigPath,
      JSON.stringify({
        ...mockConfig,
        agentPresets: {
          opusplan: {
            displayName: "Opus Plan",
            architect: { providerId: "mock-anthropic", model: "claude-3-opus" },
            coder: { providerId: "mock-openai", model: "gpt-4o" },
            maxSubAgents: 3
          }
        }
      }, null, 2)
    );

    try {
      const registry = new ProviderRegistry(presetConfigPath, new InMemoryProviderSecretStore());
      assert.strictEqual(registry.getAgentPresets().length, 1);

      registry.saveAgentPresets({});

      const saved = JSON.parse(fs.readFileSync(presetConfigPath, "utf-8"));
      assert.deepStrictEqual(saved.agentPresets, {});

      const reloaded = new ProviderRegistry(presetConfigPath, new InMemoryProviderSecretStore());
      assert.deepStrictEqual(reloaded.getAgentPresets(), []);
    } finally {
      if (fs.existsSync(presetConfigPath)) {
        fs.unlinkSync(presetConfigPath);
      }
    }
  });

  await t.test("OpenAICompatibleProvider - completes successfully and maps format", async () => {
    const provider = new OpenAICompatibleProvider("http://localhost:9999", "api-key");
    
    globalThis.fetch = async (url: any, options: any) => {
      assert.strictEqual(url, "http://localhost:9999/chat/completions");
      assert.strictEqual(options.method, "POST");
      assert.strictEqual(options.headers["Authorization"], "Bearer api-key");

      const body = JSON.parse(options.body);
      assert.strictEqual(body.model, "my-gpt-model");
      assert.strictEqual(body.messages[0].role, "system");
      assert.strictEqual(body.messages[0].content, "System Instructions");
      assert.strictEqual(body.messages[1].role, "user");
      assert.strictEqual(body.messages[1].content, "Hello");

      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: { role: "assistant", content: "Hi there!" }
          }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15
          }
        })
      } as any;
    };

    const res = await provider.complete({
      model: "my-gpt-model",
      systemPrompt: "System Instructions",
      messages: [{ role: "user", content: "Hello" }]
    });

    assert.strictEqual(res.content, "Hi there!");
    assert.deepStrictEqual(res.usage, {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      cacheReadInputTokens: undefined
    });
  });

  await t.test("OpenAICompatibleProvider - throws error on empty response content", async () => {
    const provider = new OpenAICompatibleProvider("http://localhost:9999", "api-key");
    
    globalThis.fetch = async () => {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: { role: "assistant", content: "   " } // whitespace only
          }]
        })
      } as any;
    };

    await assert.rejects(
      provider.complete({
        model: "my-model",
        messages: [{ role: "user", content: "test" }]
      }),
      /Provider returned an empty response/
    );
  });

  await t.test("OpenAICompatibleProvider - throws raw response on non-ok status", async () => {
    const provider = new OpenAICompatibleProvider("http://localhost:9999", "api-key");
    
    globalThis.fetch = async () => {
      return {
        ok: false,
        status: 529,
        text: async () => JSON.stringify({
          error: {
            message: "Upstream model provider is temporarily unavailable. Please try again in a moment.",
            type: "server_error"
          }
        })
      } as any;
    };

    await assert.rejects(
      provider.complete({
        model: "my-model",
        messages: [{ role: "user", content: "test" }]
      }),
      /OpenAI API returned status 529: \{"error":\{"message":"Upstream model provider is temporarily unavailable/
    );
  });

  await t.test("OpenAICompatibleProvider - triggers timeout error on abort", async () => {
    const provider = new OpenAICompatibleProvider("http://localhost:9999", "api-key");
    
    globalThis.fetch = async (url: any, options: any) => {
      // Simulate timeout by listening to abort signal
      return new Promise((_, reject) => {
        if (options.signal) {
          options.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    };

    // Replace setTimeout global temporarily to trigger abort immediately
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((cb: any, ms: number) => {
      // Execute instantly to simulate timeout abort
      return originalSetTimeout(cb, 5);
    }) as any;

    try {
      await assert.rejects(
        provider.complete({
          model: "my-model",
          messages: [{ role: "user", content: "test" }]
        }),
        /Request to provider timed out after 300000ms with no response data/
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  await t.test("AnthropicProvider - completes successfully and maps format", async () => {
    const provider = new AnthropicProvider("http://localhost:9999", "ant-key");
    
    globalThis.fetch = async (url: any, options: any) => {
      assert.strictEqual(url, "http://localhost:9999/v1/messages");
      assert.strictEqual(options.method, "POST");
      assert.strictEqual(options.headers["x-api-key"], "ant-key");
      assert.strictEqual(options.headers["anthropic-version"], "2023-06-01");

      const body = JSON.parse(options.body);
      assert.strictEqual(body.model, "claude-model");
      // System prompt is sent as a cacheable text block.
      assert.deepStrictEqual(body.system, [
        { type: "text", text: "System prompt", cache_control: { type: "ephemeral" } }
      ]);
      assert.strictEqual(body.messages.length, 1);
      assert.strictEqual(body.messages[0].role, "user");
      // The last message's tail block carries the rolling cache breakpoint, so a
      // plain string turn is promoted to a text block.
      assert.deepStrictEqual(body.messages[0].content, [
        { type: "text", text: "Claude hello", cache_control: { type: "ephemeral" } }
      ]);

      return {
        ok: true,
        json: async () => ({
          content: [
            { type: "text", text: "Hello from " },
            { type: "text", text: "Claude!" }
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 8
          }
        })
      } as any;
    };

    const res = await provider.complete({
      model: "claude-model",
      systemPrompt: "System prompt",
      messages: [{ role: "user", content: "Claude hello" }]
    });

    assert.strictEqual(res.content, "Hello from \nClaude!");
    assert.deepStrictEqual(res.usage, {
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      cacheReadInputTokens: undefined,
      cacheWriteInputTokens: undefined
    });
  });

  await t.test("AnthropicProvider - throws error on empty response content", async () => {
    const provider = new AnthropicProvider("http://localhost:9999", "ant-key");
    
    globalThis.fetch = async () => {
      return {
        ok: true,
        json: async () => ({
          content: [
            { type: "text", text: "" }
          ]
        })
      } as any;
    };

    await assert.rejects(
      provider.complete({
        model: "claude-model",
        messages: [{ role: "user", content: "test" }]
      }),
      /Provider returned an empty response/
    );
  });

  await t.test("AnthropicProvider - throws raw response on non-ok status", async () => {
    const provider = new AnthropicProvider("http://localhost:9999", "ant-key");
    
    globalThis.fetch = async () => {
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({
          error: {
            message: "Overloaded",
            type: "api_error"
          }
        })
      } as any;
    };

    await assert.rejects(
      provider.complete({
        model: "claude-model",
        messages: [{ role: "user", content: "test" }]
      }),
      /Anthropic API returned status 500: \{"error":\{"message":"Overloaded/
    );
  });

  await t.test("AnthropicProvider - maps tools, tool_use and tool_result", async () => {
    const provider = new AnthropicProvider("http://localhost:9999", "ant-key");

    let sentBody: any;
    globalThis.fetch = async (_url: any, options: any) => {
      sentBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          content: [
            { type: "text", text: "Writing the file." },
            { type: "tool_use", id: "toolu_1", name: "write_file", input: { path: "a.txt", content: "hi" } }
          ],
          usage: { input_tokens: 5, output_tokens: 3 }
        })
      } as any;
    };

    const res = await provider.complete({
      model: "claude-model",
      messages: [
        { role: "user", content: "create a.txt" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "toolu_0", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } }
          ]
        },
        { role: "tool", content: '{"success":false}', tool_call_id: "toolu_0", name: "read_file" }
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "write_file",
            description: "Writes a file",
            parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
          }
        }
      ]
    });

    // Tools are mapped to Anthropic schema.
    assert.strictEqual(sentBody.tools[0].name, "write_file");
    assert.strictEqual(sentBody.tools[0].description, "Writes a file");
    assert.deepStrictEqual(sentBody.tools[0].input_schema.required, ["path"]);

    // Assistant tool call becomes a tool_use block.
    assert.strictEqual(sentBody.messages[1].role, "assistant");
    assert.strictEqual(sentBody.messages[1].content[0].type, "tool_use");
    assert.deepStrictEqual(sentBody.messages[1].content[0].input, { path: "a.txt" });

    // Tool result becomes a tool_result block on a user turn.
    assert.strictEqual(sentBody.messages[2].role, "user");
    assert.strictEqual(sentBody.messages[2].content[0].type, "tool_result");
    assert.strictEqual(sentBody.messages[2].content[0].tool_use_id, "toolu_0");

    // Response tool_use is mapped back to our toolCalls shape.
    assert.strictEqual(res.content, "Writing the file.");
    assert.strictEqual(res.toolCalls?.[0].function.name, "write_file");
    assert.deepStrictEqual(JSON.parse(res.toolCalls![0].function.arguments), { path: "a.txt", content: "hi" });
  });
});
