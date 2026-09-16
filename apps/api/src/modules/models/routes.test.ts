import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { prisma } from "../../lib/prisma.js";
import { modelRoutes } from "./routes.js";

test("models are available without a login or wallet", async (t) => {
  const original = prisma.llmModel.findMany;
  let query: unknown;
  Reflect.set(prisma.llmModel, "findMany", async (input: unknown) => {
    query = input;
    return [{ id: "model-1", displayName: "Model", provider: "openrouter", providerModelId: "vendor/model", enabled: true,
      inputAppTokensPer1k: 0, outputAppTokensPer1k: 0, minimumRequiredBalance: 0, maxOutputTokens: 1000, contextWindowTokens: 64000, sortOrder: 0 }];
  });
  t.after(() => { Reflect.set(prisma.llmModel, "findMany", original); });
  const app = Fastify();
  await app.register(modelRoutes);
  t.after(() => app.close());
  const response = await app.inject({ url: "/models" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().models.map((model: { id: string }) => model.id), ["model-1"]);
  assert.deepEqual(query, { where: { enabled: true, provider: "openrouter" }, orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }] });
});

test("initializes visitor defaults when the database only has wallet models", async (t) => {
  const originalFind = prisma.llmModel.findMany;
  const originalCount = prisma.llmModel.count;
  const originalCreate = prisma.llmModel.createMany;
  let created: unknown;
  Reflect.set(prisma.llmModel, "findMany", async () => created ? [{
    id: "seed-deepseek-chat", displayName: "DeepSeek Chat", displayNameZh: null,
    modelSeriesName: null, modelSeriesNameZh: null, provider: "openrouter",
    providerModelId: "deepseek/deepseek-chat", logoUrl: null, enabled: true,
    inputAppTokensPer1k: 0, outputAppTokensPer1k: 0, minimumRequiredBalance: 0,
    maxOutputTokens: 2000, contextWindowTokens: 64000, sortOrder: 10
  }] : []);
  Reflect.set(prisma.llmModel, "count", async () => 0);
  Reflect.set(prisma.llmModel, "createMany", async (input: unknown) => { created = input; return { count: 2 }; });
  t.after(() => {
    Reflect.set(prisma.llmModel, "findMany", originalFind);
    Reflect.set(prisma.llmModel, "count", originalCount);
    Reflect.set(prisma.llmModel, "createMany", originalCreate);
  });
  const app = Fastify();
  await app.register(modelRoutes);
  t.after(() => app.close());
  const response = await app.inject({ url: "/models" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().models[0].id, "seed-deepseek-chat");
  assert.equal((created as { skipDuplicates: boolean }).skipDuplicates, true);
});

test("respects an intentionally disabled OpenRouter catalog", async (t) => {
  const originalFind = prisma.llmModel.findMany;
  const originalCount = prisma.llmModel.count;
  const originalCreate = prisma.llmModel.createMany;
  let created = false;
  Reflect.set(prisma.llmModel, "findMany", async () => []);
  Reflect.set(prisma.llmModel, "count", async () => 2);
  Reflect.set(prisma.llmModel, "createMany", async () => { created = true; return { count: 0 }; });
  t.after(() => {
    Reflect.set(prisma.llmModel, "findMany", originalFind);
    Reflect.set(prisma.llmModel, "count", originalCount);
    Reflect.set(prisma.llmModel, "createMany", originalCreate);
  });
  const app = Fastify();
  await app.register(modelRoutes);
  t.after(() => app.close());
  const response = await app.inject({ url: "/models" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().models, []);
  assert.equal(created, false);
});
