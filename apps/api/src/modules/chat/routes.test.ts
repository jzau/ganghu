import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { prisma } from "../../lib/prisma.js";
import { encryptCredential } from "../../lib/crypto.js";
import { env } from "../../lib/env.js";
import { chatRoutes } from "./routes.js";

// Stop at the persistence boundary so these route checks never run inference,
// bill Toking, or require a database.
test("an existing conversation accepts another Toking model; ownership and connection checks remain enforced", async (t) => {
  function stub(target: object, key: string, replacement: unknown) {
    const original = Reflect.get(target, key);
    Reflect.set(target, key, replacement);
    t.after(() => { Reflect.set(target, key, original); });
  }
  let connected = true;
  let exhausted = false;
  let ownsConversation = true;
  let enabledModel = true;
  let appTokenBalance = 10_000;
  let accepted: unknown;
  const model = { id: "model-b", provider: "toking", providerModelId: "gangram/vendor/model", minimumRequiredBalance: 0 };
  const gangramModel = { id: "model-local", provider: "openrouter", providerModelId: "gangram/vendor/model", minimumRequiredBalance: 1000 };
  const encryptedKey = encryptCredential("tk_live_test_customer_key");
  stub(prisma.user, "findUniqueOrThrow", async () => ({
    id: "user-1",
    appTokenBalance,
    tokingCreditsExhausted: exhausted,
    tokingApiKeyEncrypted: connected ? encryptedKey : null,
    tokingBaseUrl: connected ? "http://localhost:3200/v1" : null
  }));
  stub(prisma.llmModel, "findFirst", async ({ where }: { where: { id?: string; enabled: boolean; provider?: string; providerModelId?: string } }) => {
    if (where.id) {
      assert.equal(where.id, "model-b");
      assert.equal(where.enabled, true);
      return enabledModel ? model : null;
    }
    assert.deepEqual(where, { enabled: true, provider: "openrouter", providerModelId: "gangram/vendor/model" });
    return gangramModel;
  });
  stub(prisma.conversation, "findFirst", async ({ where }: { where: { id: string; userId: string; deletedAt: null } }) => {
    assert.deepEqual(where, { id: "conversation-1", userId: "user-1", deletedAt: null });
    return ownsConversation ? { id: "conversation-1" } : null;
  });
  stub(prisma.message, "findFirst", async () => ({ modelId: "model-a" }));
  stub(prisma.message, "create", async (input: unknown) => {
    accepted = input;
    throw new Error("test-persistence-boundary");
  });
  const app = Fastify();
  app.decorate("authenticateUser", async (request: { user?: unknown }) => { request.user = { id: "user-1" }; });
  app.setErrorHandler((error, _request, reply) => {
    if (error.message === "test-persistence-boundary") return reply.code(200).send({ accepted: true });
    return reply.code(500).send({ message: error.message });
  });
  await app.register(chatRoutes);
  t.after(() => app.close());
  const send = () => app.inject({ method: "POST", url: "/chat/stream", payload: { conversationId: "conversation-1", modelId: "model-b", message: "Continue with another model", searchMode: "off" } });
  assert.equal((await send()).statusCode, 200);
  assert.deepEqual(accepted, { data: { conversationId: "conversation-1", role: "user", content: "Continue with another model", modelId: "model-b" } });
  accepted = undefined;
  ownsConversation = false;
  assert.equal((await send()).statusCode, 404);
  assert.equal(accepted, undefined);
  ownsConversation = true;
  connected = false;
  assert.equal((await send()).statusCode, 200);
  assert.deepEqual(accepted, { data: { conversationId: "conversation-1", role: "user", content: "Continue with another model", modelId: "model-local" } });
  accepted = undefined;
  connected = true;
  exhausted = true;
  assert.equal((await send()).statusCode, 200);
  assert.deepEqual(accepted, { data: { conversationId: "conversation-1", role: "user", content: "Continue with another model", modelId: "model-local" } });
  accepted = undefined;
  appTokenBalance = 999;
  assert.equal((await send()).statusCode, 402);
  assert.equal(accepted, undefined);
  appTokenBalance = 10_000;
  exhausted = false;
  connected = true;
  enabledModel = false;
  assert.equal((await send()).statusCode, 404);
  assert.equal(accepted, undefined);
});

test("conversation search is scoped to the authenticated user and returns a matching message snippet", async (t) => {
  const originalFindMany = prisma.conversation.findMany;
  let receivedWhere: unknown;
  Reflect.set(prisma.conversation, "findMany", async (input: { where: unknown }) => {
    receivedWhere = input.where;
    return [{
      id: "conversation-1",
      title: "Launch notes",
      updatedAt: new Date("2026-09-07T00:00:00.000Z"),
      messages: [{ content: "The Singapore launch checklist is ready." }]
    }];
  });
  t.after(() => { Reflect.set(prisma.conversation, "findMany", originalFindMany); });

  const app = Fastify();
  app.decorate("authenticateUser", async (request: { user?: unknown }) => { request.user = { id: "user-1" }; });
  await app.register(chatRoutes);
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/conversations/search?q=Singapore" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().results[0].snippet, "The Singapore launch checklist is ready.");
  assert.deepEqual(receivedWhere, {
    userId: "user-1",
    deletedAt: null,
    OR: [
      { title: { contains: "Singapore", mode: "insensitive" } },
      { messages: { some: { content: { contains: "Singapore", mode: "insensitive" } } } }
    ]
  });
});

test("an insufficient Toking reservation falls back once, charges Gangram credits, and persists local routing", async (t) => {
  function stub(target: object, key: string, replacement: unknown) {
    const original = Reflect.get(target, key);
    Reflect.set(target, key, replacement);
    t.after(() => { Reflect.set(target, key, original); });
  }

  const originalFetch = globalThis.fetch;
  const originalOpenRouterKey = env.OPENROUTER_API_KEY;
  Reflect.set(env, "OPENROUTER_API_KEY", "openrouter-test-key");
  t.after(() => {
    globalThis.fetch = originalFetch;
    Reflect.set(env, "OPENROUTER_API_KEY", originalOpenRouterKey);
  });

  const now = new Date("2026-09-16T00:00:00.000Z");
  const tokingModel = {
    id: "toking-model",
    provider: "toking",
    providerModelId: "vendor/model",
    minimumRequiredBalance: 0,
    inputAppTokensPer1k: 0,
    outputAppTokensPer1k: 0,
    maxOutputTokens: 1000,
    contextWindowTokens: 64000
  };
  const gangramModel = {
    ...tokingModel,
    id: "gangram-model",
    provider: "openrouter",
    minimumRequiredBalance: 1000,
    inputAppTokensPer1k: 1000,
    outputAppTokensPer1k: 2000
  };
  const user = {
    id: "user-1",
    appTokenBalance: 10_000,
    tokingCreditsExhausted: false,
    tokingApiKeyEncrypted: encryptCredential("tk_live_customer"),
    tokingBaseUrl: "https://api.toking.test/v1",
    tokingBalance: "5"
  };
  const conversation = { id: "conversation-1", userId: "user-1", title: "New chat", createdAt: now, updatedAt: now, deletedAt: null };
  let modelLookup = 0;
  let messageCreate = 0;
  let exhaustedUpdate: unknown;
  let ledgerEntry: unknown;
  let usageRecord: unknown;

  stub(prisma.user, "findUniqueOrThrow", async () => user);
  stub(prisma.user, "update", async (input: unknown) => { exhaustedUpdate = input; return user; });
  stub(prisma.llmModel, "findFirst", async () => (++modelLookup === 1 ? tokingModel : gangramModel));
  stub(prisma.conversation, "findFirst", async () => conversation);
  stub(prisma.message, "findMany", async () => []);
  stub(prisma.message, "create", async ({ data }: { data: Record<string, unknown> }) => {
    messageCreate += 1;
    return { id: `message-${messageCreate}`, createdAt: now, ...data };
  });
  stub(prisma.appSetting, "findUnique", async () => null);
  stub(prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) => callback({
    user: {
      findUniqueOrThrow: async () => user,
      update: async () => ({ ...user, appTokenBalance: 9800 })
    },
    appTokenLedger: { create: async ({ data }: { data: unknown }) => { ledgerEntry = data; } },
    chatUsageRecord: { create: async ({ data }: { data: unknown }) => { usageRecord = data; } },
    conversation: { update: async () => conversation }
  }));

  const requests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
    if (requests.length === 1) {
      return Response.json({ error: { message: "insufficient credits" } }, { status: 402 });
    }
    return new Response([
      `data: ${JSON.stringify({ id: "completion-1", choices: [{ delta: { content: "Hello" } }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } })}`,
      "data: [DONE]",
      ""
    ].join("\n"), { headers: { "content-type": "text/event-stream" } });
  };

  const app = Fastify();
  app.decorate("authenticateUser", async (request: { user?: unknown }) => { request.user = { id: "user-1" }; });
  await app.register(chatRoutes);
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/chat/stream",
    payload: { conversationId: "conversation-1", modelId: "toking-model", message: "Brisbane weather today", searchMode: "off" }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(requests, [{
    url: "https://api.toking.test/v1/chat/completions",
    authorization: "Bearer tk_live_customer"
  }, {
    url: `${env.OPENROUTER_BASE_URL}/chat/completions`,
    authorization: "Bearer openrouter-test-key"
  }]);
  assert.deepEqual(exhaustedUpdate, { where: { id: "user-1" }, data: { tokingCreditsExhausted: true } });
  assert.deepEqual(ledgerEntry, {
    userId: "user-1",
    type: "chat_usage",
    amount: -200,
    balanceAfter: 9800,
    sourceType: "message",
    sourceId: "message-2",
    metadata: { requestedCharge: 200, billingSystem: "gangram" }
  });
  assert.equal((usageRecord as { modelId: string }).modelId, "gangram-model");
  assert.equal((usageRecord as { totalAppTokensCharged: number }).totalAppTokensCharged, 200);
  assert.match(response.body, /event: done/);
  assert.match(response.body, /"updatedBalance":9800/);
});
