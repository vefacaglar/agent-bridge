import test from "node:test";
import assert from "node:assert";
import { SearchService } from "./SearchService.js";
import { InMemoryProviderSecretStore } from "../providers/ProviderSecretStore.js";

const originalFetch = globalThis.fetch;

test("SearchService - uses DuckDuckGo fallback by default", async (t) => {
  t.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

    globalThis.fetch = async (url: any) => {
    assert.ok(String(url).includes("duckduckgo.com"));
    return {
      ok: true,
      status: 200,
      text: async () => `
        <div class="result">
          <a class="result__a" href="https://example.com">Example</a>
          <a class="result__snippet">An example snippet.</a>
        </div>
        </body>
      `
    } as any;
  };

  const service = new SearchService({ engine: "duckduckgo" }, new InMemoryProviderSecretStore());
  const res = await service.search("example");

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.source, "duckduckgo");
  assert.strictEqual(res.results.length, 1);
  assert.strictEqual(res.results[0].title, "Example");
  assert.strictEqual(res.results[0].url, "https://example.com/");
});

test("SearchService - calls Brave API when key is provided", async (t) => {
  t.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  let fetchedUrl: string | null = null;
  globalThis.fetch = async (url: any, options: any) => {
    fetchedUrl = String(url);
    assert.strictEqual(options.headers["X-Subscription-Token"], "brave-key");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        web: {
          results: [
            { title: "Brave Result", url: "https://brave.com/result", description: "From Brave" }
          ]
        }
      })
    } as any;
  };

  const service = new SearchService({ engine: "brave", braveApiKey: "brave-key" }, new InMemoryProviderSecretStore());
  const res = await service.search("test");

  assert.ok(fetchedUrl?.includes("api.search.brave.com"));
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.source, "brave");
  assert.strictEqual(res.results[0].title, "Brave Result");
});

test("SearchService - resolves Brave key from secret store ref", async (t) => {
  t.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const store = new InMemoryProviderSecretStore();
  const ref = store.set("search:brave", "stored-brave-key");

  globalThis.fetch = async (_url: any, options: any) => {
    assert.strictEqual(options.headers["X-Subscription-Token"], "stored-brave-key");
    return {
      ok: true,
      status: 200,
      json: async () => ({ web: { results: [] } })
    } as any;
  };

  const service = new SearchService({ engine: "brave", braveApiKeyRef: ref }, store);
  const res = await service.search("x");
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.source, "brave");
});

test("SearchService - falls back to DuckDuckGo when Brave key is missing", async (t) => {
  t.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url: any) => {
    assert.ok(String(url).includes("duckduckgo.com"));
    return { ok: true, status: 200, text: async () => "" } as any;
  };

  const service = new SearchService({ engine: "brave" }, new InMemoryProviderSecretStore());
  const res = await service.search("x");

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.source, "duckduckgo");
});

test("SearchService - calls Google API when key and cx are provided", async (t) => {
  t.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  let fetchedUrl: string | null = null;
  globalThis.fetch = async (url: any) => {
    fetchedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { title: "Google Result", link: "https://google.com/result", snippet: "From Google" }
        ]
      })
    } as any;
  };

  const service = new SearchService({
    engine: "google",
    googleApiKey: "google-key",
    googleSearchEngineId: "cx-123"
  }, new InMemoryProviderSecretStore());

  const res = await service.search("test");

  assert.ok(fetchedUrl?.includes("googleapis.com"));
  assert.ok(fetchedUrl?.includes("key=google-key"));
  assert.ok(fetchedUrl?.includes("cx=cx-123"));
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.source, "google");
  assert.strictEqual(res.results[0].title, "Google Result");
});

test("SearchService - returns error for empty query", async () => {
  const service = new SearchService({ engine: "duckduckgo" }, new InMemoryProviderSecretStore());
  const res = await service.search("  ");
  assert.strictEqual(res.success, false);
  assert.ok(res.error?.includes("Missing parameter"));
});
