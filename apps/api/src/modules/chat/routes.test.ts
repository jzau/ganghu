import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Fastify from "fastify";
import { prisma } from "../../lib/prisma.js";
import { chatRoutes } from "./routes.js";

function stub(t: TestContext, target: object, key: string, replacement: unknown) {
  const original = Reflect.get(target, key);
  Reflect.set(target, key, replacement);
  t.after(() => { Reflect.set(target, key, original); });
}

test("a visitor can start chat with zero credits, while another visitor cannot read the conversation", async (t) => {
  const model = { id: "model-1", provider: "openrouter", providerModelId: "vendor/model", minimumRequiredBalance: 1000 };
  let accepted: unknown;
  stub(t, prisma.llmModel, "findFirst", async () => model);
  stub(t, prisma.conversation, "findFirst", async ({ where }: { where: { userId: string } }) =>
    where.userId === "visitor-1" ? { id: "conversation-1" } : null);
  stub(t, prisma.message, "create", async (input: unknown) => {
    accepted = input;
    throw new Error("persistence-boundary");
  });
  const app = Fastify();
  let visitorId = "visitor-1";
  app.decorate("authenticateChatUser", async (request: { user?: unknown }) => { request.user = { id: visitorId }; });
  app.setErrorHandler((error, _request, reply) => {
    if (error.message === "persistence-boundary") return reply.code(200).send({ accepted: true });
    return reply.code(500).send({ message: error.message });
  });
  await app.register(chatRoutes);
  t.after(() => app.close());
  const send = () => app.inject({ method: "POST", url: "/chat/stream", payload: { conversationId: "conversation-1", modelId: "model-1", message: "Hello", searchMode: "off" } });
  assert.equal((await send()).statusCode, 200);
  assert.deepEqual(accepted, { data: { conversationId: "conversation-1", role: "user", content: "Hello", modelId: "model-1" } });
  accepted = undefined;
  visitorId = "visitor-2";
  assert.equal((await send()).statusCode, 404);
  assert.equal(accepted, undefined);
});

test("conversation search stays scoped to the visitor", async (t) => {
  let receivedWhere: unknown;
  stub(t, prisma.conversation, "findMany", async (input: { where: unknown }) => {
    receivedWhere = input.where;
    return [];
  });
  const app = Fastify();
  app.decorate("authenticateChatUser", async (request: { user?: unknown }) => { request.user = { id: "visitor-1" }; });
  await app.register(chatRoutes);
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/conversations/search?q=Singapore" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedWhere, {
    userId: "visitor-1", deletedAt: null,
    OR: [
      { title: { contains: "Singapore", mode: "insensitive" } },
      { messages: { some: { content: { contains: "Singapore", mode: "insensitive" } } } }
    ]
  });
});
