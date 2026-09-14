import assert from "node:assert/strict";
import test from "node:test";
import { streamOpenRouterChat } from "../llm/openrouter.js";
import { planSearchAutomatically } from "../search/search-planner.js";

test("streams user chat through the saved Toking base URL and customer key", async (t) => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; authorization: string | null; body: Record<string, unknown> } | undefined;
  globalThis.fetch = async (url, init) => {
    request = {
      url: String(url),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body))
    };
    return new Response([
      `data: ${JSON.stringify({ id: "completion-1", choices: [{ delta: { content: "Hello" } }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })}`,
      "data: [DONE]",
      ""
    ].join("\n"), { headers: { "content-type": "text/event-stream" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const stream = streamOpenRouterChat({
    model: "gangram/vendor/model",
    messages: [{ role: "user", content: "Hi" }],
    maxTokens: 100,
    connection: { baseUrl: "https://api.toking.test/v1", apiKey: "tk_live_customer" }
  });
  let result = await stream.next();
  assert.deepEqual(result.value, { delta: "Hello" });
  result = await stream.next();
  assert.equal(result.done, true);
  assert.equal(request?.url, "https://api.toking.test/v1/chat/completions");
  assert.equal(request?.authorization, "Bearer tk_live_customer");
  assert.equal(request?.body.model, "gangram/vendor/model");
  assert.equal(request?.body.stream, true);
});

test("routes the semantic search planner through Toking as well", async (t) => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; authorization: string | null; model?: unknown } | undefined;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as { model?: unknown };
    request = {
      url: String(url),
      authorization: new Headers(init?.headers).get("authorization"),
      model: body.model
    };
    return Response.json({
      id: "planner-1",
      choices: [{ message: { content: JSON.stringify({
        needsSearch: false,
        intent: "general_knowledge",
        timeRange: null,
        topic: null,
        region: null,
        queries: [],
        responseStyle: "concise",
        confidence: 0.9
      }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const execution = await planSearchAutomatically({
    message: "Explain recursion simply",
    signal: new AbortController().signal,
    deadline: Date.now() + 10_000,
    plannerModel: "gangram/vendor/model",
    connection: { baseUrl: "https://api.toking.test/v1", apiKey: "tk_live_customer" }
  });
  assert.equal(execution.source, "llm");
  assert.equal(request?.url, "https://api.toking.test/v1/chat/completions");
  assert.equal(request?.authorization, "Bearer tk_live_customer");
  assert.equal(request?.model, "gangram/vendor/model");
});
