import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert";
import { ProviderRegistry } from "./ProviderRegistry.js";
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
    const registry = new ProviderRegistry(testConfigPath);
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
    const registry = new ProviderRegistry(testConfigPath);
    const provider1 = registry.getProvider("mock-openai");
    const provider2 = registry.getProvider("mock-openai");

    assert.ok(provider1 instanceof OpenAICompatibleProvider);
    // Registry should cache providers and return the exact same instance
    assert.strictEqual(provider1, provider2);

    const anthropicProvider = registry.getProvider("mock-anthropic");
    assert.ok(anthropicProvider instanceof AnthropicProvider);
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
      totalTokens: 15
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
        /Request to provider timed out after 60000ms/
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
      assert.strictEqual(body.system, "System prompt");
      assert.strictEqual(body.messages.length, 1);
      assert.strictEqual(body.messages[0].role, "user");
      assert.strictEqual(body.messages[0].content, "Claude hello");

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
      totalTokens: 20
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
});
