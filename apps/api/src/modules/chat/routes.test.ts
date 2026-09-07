import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { prisma } from "../../lib/prisma.js";
import { chatRoutes } from "./routes.js";

// Stop at the persistence boundary so these route checks never run inference,
// change a real balance, or require a database.
test("an existing conversation accepts another enabled model; ownership and balance checks remain enforced", async (t) => {
  function stub(target: object, key: string, replacement: unknown) {
    const original = Reflect.get(target, key);
    Reflect.set(target, key, replacement);
    t.after(() => { Reflect.set(target, key, original); });
  }
  let balance = 1000;
  let ownsConversation = true;
  let enabledModel = true;
  let accepted: unknown;
  const model = { id: "model-b", provider: "openrouter", minimumRequiredBalance: 100 };
  stub(prisma.user, "findUniqueOrThrow", async () => ({ id: "user-1", appTokenBalance: balance }));
  stub(prisma.llmModel, "findFirst", async ({ where }: { where: { id: string; enabled: boolean } }) => {
    assert.equal(where.id, "model-b");
    assert.equal(where.enabled, true);
    return enabledModel ? model : null;
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
  balance = 0;
  assert.equal((await send()).statusCode, 402);
  assert.equal(accepted, undefined);
  balance = 1000;
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
