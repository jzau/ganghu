import assert from "node:assert/strict";
import test from "node:test";
import { buildAssistantInstructions } from "../context/assistant-instructions.js";
import { buildExternalSearchContext } from "../context/external-content.js";
import { TavilyProvider } from "./providers/tavily-provider.js";
import { normalizeAndDeduplicateResults } from "./result-normalizer.js";
import { buildSearchRequests, filterResultsForPlan, planAutomaticSearch, resolveSearchMode, shouldSearchAutomatically } from "./search-service.js";

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
  assert.equal(shouldSearchAutomatically("Why does weather change?"), false);
  assert.equal(shouldSearchAutomatically("How is the weather in Sydney?"), true);
});

test("plans a fresh, enriched weather search", () => {
  const plan = planAutomaticSearch({
    message: "How is the weather in Sydney?"
  });

  assert.deepEqual(plan, {
    needsSearch: true,
    query: "How is the weather in Sydney? official weather forecast",
    queries: ["How is the weather in Sydney? official weather forecast"],
    freshness: "day",
    category: "weather",
    reason: "fresh_information"
  });
});

test("uses recent conversation context for an underspecified follow-up", () => {
  const plan = planAutomaticSearch({
    message: "What about tomorrow?",
    recentMessages: [
      { role: "user", content: "How is the weather in Sydney?" },
      { role: "assistant", content: "It is cool today." },
      { role: "user", content: "What about tomorrow?" }
    ]
  });

  assert.equal(plan.needsSearch, true);
  assert.equal(plan.category, "weather");
  assert.equal(plan.freshness, "day");
  assert.equal(plan.query, "How is the weather in Sydney? What about tomorrow? official weather forecast");
});

test("decomposes a broad Chinese news request into focused searches", () => {
  const plan = planAutomaticSearch({ message: "今天的新闻" });

  assert.equal(plan.category, "news");
  assert.equal(plan.freshness, "day");
  assert.deepEqual(plan.queries, [
    "今天的新闻",
    "今日中国重要新闻",
    "今日国际重大新闻",
    "今日财经科技新闻"
  ]);

  const requests = buildSearchRequests(plan, 5);
  assert.equal(requests.length, 4);
  assert.equal(requests[0].topic, "news");
  assert.equal(requests[0].searchDepth, "basic");
  assert.equal(requests[0].includeRawContent, "markdown");
});

test("filters social posts from freshness-sensitive evidence and renumbers sources", () => {
  const filtered = filterResultsForPlan([
    { sourceId: "S1", title: "Social post", url: "https://facebook.com/post/1", snippet: "Weather", provider: "fake", rank: 1 },
    { sourceId: "S2", title: "Official forecast", url: "https://weather.example/forecast", snippet: "Forecast", provider: "fake", rank: 2 }
  ], {
    needsSearch: true,
    query: "Sydney weather",
    freshness: "day",
    category: "weather",
    reason: "fresh_information"
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, "Official forecast");
  assert.equal(filtered[0].sourceId, "S1");
  assert.equal(filtered[0].rank, 1);
});

test("rejects reference pages and prioritizes current established news sources", () => {
  const filtered = filterResultsForPlan([
    { sourceId: "S1", title: "Definition", url: "https://baike.baidu.com/item/news", snippet: "Definition", provider: "fake", rank: 1, relevanceScore: 0.99 },
    { sourceId: "S2", title: "Older blog", url: "https://example.com/story", snippet: "Story", provider: "fake", rank: 2, relevanceScore: 0.9 },
    { sourceId: "S3", title: "Current report", url: "https://www.reuters.com/world/story", snippet: "Report", rawContent: "Full report", publishedAt: new Date().toISOString(), provider: "fake", rank: 3, relevanceScore: 0.8 }
  ], {
    needsSearch: true,
    query: "today's news",
    freshness: "day",
    category: "news",
    reason: "fresh_information"
  });

  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].title, "Current report");
  assert.equal(filtered.some((result) => result.title === "Definition"), false);
});

test("defaults omitted search mode to auto and preserves explicit overrides", () => {
  assert.equal(resolveSearchMode({}), "auto");
  assert.equal(resolveSearchMode({ searchMode: "off" }), "off");
  assert.equal(resolveSearchMode({ searchMode: "explicit" }), "explicit");
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
  assert.match(context, /Answer the user's question directly/);
  assert.match(context, /never narrate the search/);
});

test("uses a digest response profile for broad news", () => {
  const instructions = buildAssistantInstructions("news");
  assert.match(instructions, /produce a useful digest/);
  assert.match(instructions, /Do not treat dictionaries, encyclopedias/);
  assert.doesNotMatch(instructions, /one to three concise sentences/);
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
      topic: "general",
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

test("Tavily adapter forwards news retrieval options and maps page evidence", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      results: [{
        title: "Current report",
        url: "https://example.com/report",
        content: "Relevant snippets",
        raw_content: "Cleaned article content",
        published_date: "2026-07-22T00:00:00Z",
        score: 0.91
      }]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const response = await new TavilyProvider("test-key", "https://api.tavily.com").search({
      query: "today's news",
      maxResults: 5,
      freshness: "day",
      topic: "news",
      searchDepth: "basic",
      includeRawContent: "markdown"
    }, new AbortController().signal);
    assert.equal(requestBody?.time_range, "day");
    assert.equal(requestBody?.topic, "news");
    assert.equal(requestBody?.search_depth, "basic");
    assert.equal(requestBody?.include_raw_content, "markdown");
    assert.equal(response.results[0].rawContent, "Cleaned article content");
    assert.equal(response.results[0].relevanceScore, 0.91);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
