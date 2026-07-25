import assert from "node:assert/strict";
import test from "node:test";
import { env } from "../../lib/env.js";
import { buildAssistantInstructions } from "../context/assistant-instructions.js";
import { buildExternalSearchContext } from "../context/external-content.js";
import { completeOpenRouterStructured } from "../llm/openrouter.js";
import { AliyunIqsProvider } from "./providers/aliyun-iqs-provider.js";
import { TavilyProvider } from "./providers/tavily-provider.js";
import { normalizeAndDeduplicateResults } from "./result-normalizer.js";
import { planSearchAutomatically, toAutoSearchPlan } from "./search-planner.js";
import { buildSearchRequests, filterResultsForPlan, planAutomaticSearch, resolveSearchMode, shouldRetrySearch, shouldSearchAutomatically } from "./search-service.js";

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

test("rule fallback recognizes a regional Chinese news digest", () => {
  const plan = planAutomaticSearch({ message: "今日澳洲新闻" });

  assert.equal(plan.category, "news");
  assert.equal(plan.freshness, "day");
  assert.deepEqual(plan.queries, [
    "今日澳洲新闻",
    "今日澳洲新闻 政治社会",
    "今日澳洲新闻 财经科技",
    "今日澳洲新闻 重大要闻"
  ]);
});

test("treats an ambiguous named-entity incident question as current news", () => {
  const plan = planAutomaticSearch({ message: "携程怎么了" });

  assert.equal(plan.needsSearch, true);
  assert.equal(plan.category, "news");
  assert.equal(plan.intent, "news_lookup");
  assert.equal(plan.topic, "news");
  assert.equal(plan.freshness, "week");
  assert.equal(plan.queries?.length, 3);
  assert.match(plan.query ?? "", /携程/);
});

test("distinguishes entity news from a broad regional news digest", () => {
  const entityPlan = planAutomaticSearch({ message: "今天携程新闻" });
  assert.equal(entityPlan.intent, "news_lookup");
  assert.equal(entityPlan.responseStyle, undefined);
  assert.equal(entityPlan.freshness, "day");
  assert.equal(entityPlan.queries?.length, 3);
  assert.match(entityPlan.query ?? "", /携程/);

  const regionalPlan = planAutomaticSearch({ message: "今日澳洲新闻" });
  assert.equal(regionalPlan.intent, "news_digest");
  assert.equal(regionalPlan.responseStyle, "news_digest");
  assert.equal(regionalPlan.queries?.length, 4);
});

test("uses the deterministic fast path for obvious current-event questions", async () => {
  const result = await planSearchAutomatically({
    message: "携程怎么了",
    signal: new AbortController().signal,
    deadline: Date.now() + 1_000
  });

  assert.equal(result.source, "rules");
  assert.equal(result.fallbackReason, "deterministic_current_intent");
  assert.equal(result.plan.needsSearch, true);
  assert.equal(result.plan.category, "news");
});

test("plans grounded research for comparisons of named projects", async () => {
  const plan = planAutomaticSearch({ message: "openworker和openclaw 有什么区别" });

  assert.equal(plan.needsSearch, true);
  assert.equal(plan.category, "research");
  assert.equal(plan.intent, "web_research");
  assert.equal(plan.freshness, "year");
  assert.deepEqual(plan.entities, ["openworker", "openclaw"]);
  assert.deepEqual(plan.queries, [
    "\"openworker\" \"openclaw\" comparison",
    "\"openworker\" official GitHub README documentation",
    "\"openclaw\" official GitHub README documentation"
  ]);

  const requests = buildSearchRequests(plan);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].topic, "general");
  assert.equal(requests[0].searchDepth, "advanced");
  assert.equal(requests[0].chunksPerSource, 3);
  assert.equal(requests[0].includeRawContent, "markdown");
  assert.equal(requests[1].exactMatch, true);
  assert.deepEqual(requests[1].includeDomains, ["github.com"]);

  const execution = await planSearchAutomatically({
    message: "openworker和openclaw 有什么区别",
    signal: new AbortController().signal,
    deadline: Date.now() + 1_000
  });
  assert.equal(execution.source, "rules");
  assert.equal(execution.fallbackReason, "deterministic_current_intent");
  assert.equal(execution.plan.category, "research");
});

test("recognizes concise Chinese comparison wording with spaces", async () => {
  const message = "openworker 和 openclaw 的区别";
  const plan = planAutomaticSearch({ message });

  assert.equal(plan.needsSearch, true);
  assert.equal(plan.category, "research");
  assert.deepEqual(plan.entities, ["openworker", "openclaw"]);

  const execution = await planSearchAutomatically({
    message,
    signal: new AbortController().signal,
    deadline: Date.now() + 1_000
  });
  assert.equal(execution.source, "rules");
  assert.equal(execution.fallbackReason, "deterministic_current_intent");
  assert.equal(execution.plan.needsSearch, true);
  assert.equal(execution.plan.queries?.length, 3);
});

test("recognizes a lookup for an unfamiliar named project", () => {
  const plan = planAutomaticSearch({ message: "OpenWorker是什么？" });

  assert.equal(plan.category, "research");
  assert.equal(plan.intent, "web_research");
  assert.deepEqual(plan.entities, ["OpenWorker"]);
  assert.equal(plan.queries?.length, 3);
});

test("maps a semantic planner decision into a bounded search plan", () => {
  const plan = toAutoSearchPlan({
    needsSearch: true,
    intent: "news_digest",
    timeRange: null,
    topic: "news",
    region: "Australia",
    queries: ["今日澳洲重要新闻", "今日澳洲财经科技新闻", "今日澳洲重要新闻"],
    responseStyle: "news_digest",
    confidence: 0.97
  });

  assert.deepEqual(plan, {
    needsSearch: true,
    query: "今日澳洲重要新闻",
    queries: ["今日澳洲重要新闻", "今日澳洲财经科技新闻"],
    freshness: "day",
    category: "news",
    intent: "news_digest",
    topic: "news",
    region: "Australia",
    reason: "fresh_information",
    responseStyle: "news_digest",
    confidence: 0.97,
    planner: "llm"
  });
});

test("forces explicit news wording onto the news retrieval path", () => {
  const plan = toAutoSearchPlan({
    needsSearch: true,
    intent: "current_fact",
    timeRange: "day",
    topic: "general",
    region: null,
    queries: ["今天携程新闻", "携程 最新消息"],
    responseStyle: "concise",
    confidence: 1
  }, "今天携程新闻");

  assert.equal(plan.category, "news");
  assert.equal(plan.intent, "news_lookup");
  assert.equal(plan.topic, "news");
  const requests = buildSearchRequests(plan);
  assert.equal(requests[0].topic, "news");
  assert.equal(requests[0].searchDepth, "advanced");
  assert.equal(requests[0].chunksPerSource, 3);
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

test("hard-rejects a dated stale article from a current news lookup", () => {
  const plan = {
    needsSearch: true,
    query: "携程 最新消息",
    queries: ["携程 最新消息"],
    freshness: "day" as const,
    category: "news" as const,
    intent: "news_lookup" as const,
    topic: "news" as const,
    reason: "fresh_information" as const
  };
  const filtered = filterResultsForPlan([
    {
      sourceId: "S1",
      title: "新闻盲盒：2026年02月25日",
      url: "https://example.com/old-ctrip-story",
      snippet: "携程历史新闻",
      relevanceScore: 0.95,
      provider: "fake",
      rank: 1
    },
    {
      sourceId: "S2",
      title: "携程最新公告",
      url: "https://example.com/current-ctrip-story",
      snippet: "携程发布最新回应",
      publishedAt: new Date().toISOString(),
      relevanceScore: 0.8,
      provider: "fake",
      rank: 2
    }
  ], plan);

  assert.deepEqual(filtered.map((result) => result.title), ["携程最新公告"]);
  assert.equal(shouldRetrySearch(filtered, plan), true);
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

test("uses an evidence-first response profile for project comparisons", () => {
  const instructions = buildAssistantInstructions("research", "detailed");
  assert.match(instructions, /official website, repository, or documentation/);
  assert.match(instructions, /instead of guessing from a name/);
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
      searchDepth: "advanced",
      chunksPerSource: 3,
      includeRawContent: "markdown"
    }, new AbortController().signal);
    assert.equal(requestBody?.time_range, "day");
    assert.equal(requestBody?.topic, "news");
    assert.equal(requestBody?.search_depth, "advanced");
    assert.equal(requestBody?.chunks_per_source, 3);
    assert.equal(requestBody?.include_raw_content, "markdown");
    assert.equal(response.results[0].rawContent, "Cleaned article content");
    assert.equal(response.results[0].relevanceScore, 0.91);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Tavily adapter forwards exact-name and domain filters", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    await new TavilyProvider("test-key", "https://api.tavily.com").search({
      query: "\"OpenWorker\" official repository",
      maxResults: 5,
      topic: "general",
      searchDepth: "basic",
      exactMatch: true,
      includeDomains: ["github.com"]
    }, new AbortController().signal);

    assert.equal(requestBody?.exact_match, true);
    assert.deepEqual(requestBody?.include_domains, ["github.com"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Alibaba IQS adapter maps platform options and search evidence", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, any> | undefined;
  let authorization: string | null | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    authorization = new Headers(init?.headers).get("Authorization");
    return new Response(JSON.stringify({
      requestId: "iqs-request-1",
      pageItems: [{
        title: "Result",
        link: "https://example.cn/story",
        snippet: "Short evidence",
        markdownText: "# Full evidence",
        publishedTime: "2026-07-25T08:00:00+08:00",
        rerankScore: 0.95
      }],
      costCredits: {
        search: { genericTextSearch: 0, liteAdvancedTextSearch: 1 },
        valueAdded: { summary: 0, advanced: 0 }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const response = await new AliyunIqsProvider(
      "iqs-key",
      "https://cloud-iqs.aliyuncs.com/search/",
      "LiteAdvanced"
    ).search({
      query: "最新科技新闻",
      maxResults: 5,
      freshness: "week",
      includeRawContent: "markdown",
      includeDomains: ["example.cn"]
    }, new AbortController().signal);

    assert.equal(authorization, "Bearer iqs-key");
    assert.deepEqual(requestBody, {
      query: "最新科技新闻",
      engineType: "LiteAdvanced",
      timeRange: "OneWeek",
      contents: {
        mainText: false,
        markdownText: true,
        summary: false,
        rerankScore: true
      },
      advancedParams: {
        numResults: "5",
        includeSites: "example.cn"
      }
    });
    assert.equal(response.requestId, "iqs-request-1");
    assert.equal(response.cost, "1");
    assert.equal(response.results[0].provider, "aliyun-iqs");
    assert.equal(response.results[0].rawContent, "# Full evidence");
    assert.equal(response.results[0].relevanceScore, 0.95);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenRouter structured completion requires the planner JSON schema", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, any> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "generation-1",
      choices: [{ message: { content: "{\"needsSearch\":false}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.001 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const response = await completeOpenRouterStructured({
      model: "deepseek/deepseek-v4-flash",
      messages: [{ role: "user", content: "Plan this" }],
      maxTokens: 300,
      schemaName: "search_plan",
      schema: {
        type: "object",
        properties: { needsSearch: { type: "boolean" } },
        required: ["needsSearch"]
      }
    });

    assert.equal(requestBody?.model, "deepseek/deepseek-v4-flash");
    assert.equal(requestBody?.temperature, 0);
    assert.equal(requestBody?.stream, false);
    assert.equal(requestBody?.response_format.type, "json_schema");
    assert.equal(requestBody?.response_format.json_schema.strict, true);
    assert.equal(requestBody?.provider.require_parameters, true);
    assert.equal(requestBody?.provider.sort.by, "latency");
    assert.deepEqual(response.parsed, { needsSearch: false });
    assert.equal(response.cost, "0.001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retries the search planner fallback model after a primary HTTP 429", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = env.OPENROUTER_API_KEY;
  const originalPrimaryModel = env.SEARCH_PLANNER_MODEL;
  const originalFallbackModel = env.SEARCH_PLANNER_FALLBACK_MODEL;
  const requestedModels: string[] = [];
  env.OPENROUTER_API_KEY = "test-key";
  env.SEARCH_PLANNER_MODEL = "deepseek/deepseek-v4-flash";
  env.SEARCH_PLANNER_FALLBACK_MODEL = "openai/gpt-5.6-luna";

  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    requestedModels.push(body.model);
    if (requestedModels.length === 1) {
      return new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      id: "fallback-generation",
      choices: [{
        message: {
          content: JSON.stringify({
            needsSearch: false,
            intent: "general_knowledge",
            timeRange: null,
            topic: null,
            region: null,
            queries: [],
            responseStyle: "concise",
            confidence: 0.99
          })
        }
      }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, cost: 0.002 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const execution = await planSearchAutomatically({
      message: "Explain photosynthesis",
      signal: new AbortController().signal,
      deadline: Date.now() + 2_000
    });

    assert.deepEqual(requestedModels, [
      "deepseek/deepseek-v4-flash",
      "openai/gpt-5.6-luna"
    ]);
    assert.equal(execution.source, "llm");
    assert.equal(execution.model, "openai/gpt-5.6-luna");
    assert.equal(execution.fallbackReason, "primary_model_rate_limited");
    assert.equal(execution.plan.needsSearch, false);
  } finally {
    globalThis.fetch = originalFetch;
    env.OPENROUTER_API_KEY = originalApiKey;
    env.SEARCH_PLANNER_MODEL = originalPrimaryModel;
    env.SEARCH_PLANNER_FALLBACK_MODEL = originalFallbackModel;
  }
});

test("does not use the search planner fallback model for non-429 errors", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = env.OPENROUTER_API_KEY;
  const originalPrimaryModel = env.SEARCH_PLANNER_MODEL;
  const originalFallbackModel = env.SEARCH_PLANNER_FALLBACK_MODEL;
  let requestCount = 0;
  env.OPENROUTER_API_KEY = "test-key";
  env.SEARCH_PLANNER_MODEL = "deepseek/deepseek-v4-flash";
  env.SEARCH_PLANNER_FALLBACK_MODEL = "openai/gpt-5.6-luna";

  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ error: { message: "Provider unavailable" } }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const execution = await planSearchAutomatically({
      message: "Explain photosynthesis",
      signal: new AbortController().signal,
      deadline: Date.now() + 2_000
    });

    assert.equal(requestCount, 1);
    assert.equal(execution.source, "rules");
    assert.match(execution.fallbackReason ?? "", /status 503/);
  } finally {
    globalThis.fetch = originalFetch;
    env.OPENROUTER_API_KEY = originalApiKey;
    env.SEARCH_PLANNER_MODEL = originalPrimaryModel;
    env.SEARCH_PLANNER_FALLBACK_MODEL = originalFallbackModel;
  }
});
