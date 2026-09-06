import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { providerRoutes } from "./routes.js";

const providerKey = "gangram-provider-key";
const model = {
  providerModelId: "openai/gpt-test",
  displayName: "GPT Test",
  contextWindowTokens: 128_000,
  maxOutputTokens: 4_096,
  createdAt: new Date("2026-09-01T00:00:00Z")
};
const providerHeaders = {
  authorization: `Bearer ${providerKey}`,
  "x-toking-provider-contract": "1"
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

async function buildProviderApp(fetchImpl: typeof fetch = async () => json({})) {
  const app = Fastify({ logger: false });
  await app.register(providerRoutes, {
    apiKeys: [providerKey],
    upstreamApiKey: "upstream-key",
    upstreamBaseUrl: "https://upstream.test/v1",
    fetchImpl,
    listModels: async () => [model, model],
    findModel: async (id) => id === model.providerModelId ? model : null
  });
  return app;
}

test("provider model catalog requires the Toking credential and contract version", async () => {
  const app = await buildProviderApp();
  const unauthorized = await app.inject({ method: "GET", url: "/models" });
  assert.equal(unauthorized.statusCode, 401);

  const response = await app.inject({ method: "GET", url: "/models", headers: providerHeaders });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), {
    object: "list",
    data: [{
      id: "openai/gpt-test",
      object: "model",
      created: 1788220800,
      owned_by: "openai",
      name: "GPT Test",
      context_length: 128_000,
      supported_parameters: ["max_tokens", "max_completion_tokens", "stream"]
    }]
  });
  await app.close();
});

test("provider chat rejects invalid requests and unavailable models before inference", async () => {
  let upstreamCalls = 0;
  const app = await buildProviderApp(async () => {
    upstreamCalls += 1;
    return json({});
  });
  const invalid = await app.inject({
    method: "POST", url: "/chat/completions", headers: providerHeaders,
    payload: { model: "openai/gpt-test", messages: [] }
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "invalid_request");

  const missing = await app.inject({
    method: "POST", url: "/chat/completions", headers: providerHeaders,
    payload: { model: "openai/missing", messages: [{ role: "user", content: "Hello" }] }
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "model_not_found");
  assert.equal(upstreamCalls, 0);
  await app.close();
});

test("provider chat proxies inference without using chatbot user or billing routes", async () => {
  let forwarded: { url: string; headers: Headers; body: Record<string, unknown> } | undefined;
  const app = await buildProviderApp(async (input, init) => {
    forwarded = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>
    };
    return json({
      id: "generation-1",
      object: "chat.completion",
      created: 1788220800,
      model: "openai/gpt-test",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3, cost: "0.00001" }
    });
  });

  const response = await app.inject({
    method: "POST",
    url: "/chat/completions",
    headers: { ...providerHeaders, "x-toking-request-id": "toking-request-1" },
    payload: {
      model: "openai/gpt-test",
      messages: [{ role: "user", content: "Hello" }],
      stream: false,
      max_completion_tokens: 99_999
    }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().usage.cost, "0.00001");
  assert.equal(forwarded?.url, "https://upstream.test/v1/chat/completions");
  assert.equal(forwarded?.headers.get("authorization"), "Bearer upstream-key");
  assert.equal(forwarded?.headers.get("x-request-id"), "toking-request-1");
  assert.equal(forwarded?.body.max_tokens, undefined);
  assert.equal(forwarded?.body.max_completion_tokens, 4_096);
  assert.deepEqual(forwarded?.body.usage, { include: true });
  await app.close();
});

test("provider chat ignores OpenRouter keepalives and passes model output and final usage through", async () => {
  const events = [
    ": OPENROUTER PROCESSING\n\n",
    ": keepalive\n\n",
    'data: {"id":"generation-stream","object":"chat.completion.chunk","created":1788220800,"model":"openai/gpt-test","choices":[{"index":0,"delta":{"content":"Hi"}}],"usage":null}\n\n',
    'data: {"id":"generation-stream","object":"chat.completion.chunk","created":1788220800,"model":"openai/gpt-test","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3,"cost":"0.00001"}}\n\n',
    "data: [DONE]\n\n"
  ];
  const app = await buildProviderApp(async () => new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(event));
      controller.close();
    }
  }), { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" } }));

  const response = await app.inject({
    method: "POST",
    url: "/chat/completions",
    headers: providerHeaders,
    payload: {
      model: "openai/gpt-test",
      stream: true,
      stream_options: { include_obfuscation: false },
      messages: [{ role: "user", content: "Hello" }]
    }
  });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"] ?? ""), /text\/event-stream/);
  assert.match(response.body, /"content":"Hi"/);
  assert.match(response.body, /"cost":"0.00001"/);
  assert.doesNotMatch(response.body, /"error"|OPENROUTER PROCESSING/);
  assert.match(response.body, /data: \[DONE\]/);
  await app.close();
});

test("provider chat supplies final OpenAI usage when the upstream stream omits it", async () => {
  const events = [
    'data: {"id":"generation-estimated","object":"chat.completion.chunk","created":1788220800,"model":"openai/gpt-test","choices":[{"index":0,"delta":{"content":"Estimated"},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n"
  ];
  const app = await buildProviderApp(async () => new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(event));
      controller.close();
    }
  }), { status: 200, headers: { "content-type": "text/event-stream" } }));

  const response = await app.inject({
    method: "POST", url: "/chat/completions", headers: providerHeaders,
    payload: { model: "openai/gpt-test", stream: true, messages: [{ role: "user", content: "Hello" }] }
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /"choices":\[\],"usage":\{"prompt_tokens":\d+,"completion_tokens":\d+,"total_tokens":\d+\}/);
  assert.ok(response.body.indexOf('"usage"') < response.body.indexOf("data: [DONE]"));
  await app.close();
});

test("provider chat rejects responses that are not OpenAI-compatible", async () => {
  const app = await buildProviderApp(async () => json({ message: "not a chat completion" }));
  const response = await app.inject({
    method: "POST", url: "/chat/completions", headers: providerHeaders,
    payload: { model: "openai/gpt-test", messages: [{ role: "user", content: "Hello" }] }
  });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, "invalid_upstream_response");
  assert.equal(response.json().error.param, null);
  await app.close();
});
