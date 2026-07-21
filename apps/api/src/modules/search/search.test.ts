import assert from "node:assert/strict";
import test from "node:test";
import { buildExternalSearchContext } from "../context/external-content.js";
import { TavilyProvider } from "./providers/tavily-provider.js";
import { normalizeAndDeduplicateResults } from "./result-normalizer.js";
import { shouldSearchAutomatically } from "./search-service.js";

test("normalizes URLs, removes tracking, and deduplicates sources", () => {
  const results = normalizeAndDeduplicateResults([
    { sourceId: "x", title: " First\u0000 ", url: "https://example.com/story/?utm_source=test#part", snippet: "one", provider: "fake", rank: 1 },
    { sourceId: "y", title: "Duplicate", url: "https://example.com/story", snippet: "two", provider: "fake", rank: 2 },
    { sourceId: "z", title: "Unsafe", url: "javascript:alert(1)", snippet: "three", provider: "fake", rank: 3 }
  ], 5);

  assert.equal(results.length, 1);
  assert.equal(results[0].sourceId, "S1");
  assert.equal(results[0].title, "First");
  assert.equal(results[0].url, "https://example.com/story");
});

test("detects freshness-sensitive prompts in English and Chinese", () => {
  assert.equal(shouldSearchAutomatically("What is the latest Bitcoin price?"), true);
  assert.equal(shouldSearchAutomatically("今天上海天气怎么样？"), true);
  assert.equal(shouldSearchAutomatically("Explain binary search"), false);
});

test("external evidence is marked untrusted and retains source identifiers", () => {
  const context = buildExternalSearchContext([{
    sourceId: "S1",
    title: "Example",
    url: "https://example.com/news",
    snippet: "Current information",
    provider: "fake",
    rank: 1
  }], new Date("2026-07-22T00:00:00.000Z"));

  assert.match(context, /untrusted reference material/);
  assert.match(context, /\[S1\]/);
  assert.match(context, /https:\/\/example\.com\/news/);
});

test("Tavily adapter sends bounded search options and maps its response", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      request_id: "request-1",
      usage: { credits: 1 },
      results: [{ title: "Result", url: "https://example.com", content: "Snippet" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const response = await new TavilyProvider("test-key", "https://api.tavily.com").search({ query: "latest news", maxResults: 5 }, new AbortController().signal);
    assert.deepEqual(requestBody, {
      query: "latest news",
      search_depth: "fast",
      max_results: 5,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      include_usage: true
    });
    assert.equal(response.requestId, "request-1");
    assert.equal(response.cost, "1");
    assert.equal(response.results[0].provider, "tavily");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
