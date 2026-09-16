import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Fastify from "fastify";
import { encryptCredential } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { modelRoutes } from "./routes.js";

const localModel = {
  id: "gangram-model",
  displayName: "Gangram Model",
  displayNameZh: null,
  modelSeriesName: null,
  modelSeriesNameZh: null,
  provider: "openrouter",
  providerModelId: "vendor/model",
  logoUrl: null,
  enabled: true,
  inputAppTokensPer1k: 1000,
  outputAppTokensPer1k: 2000,
  minimumRequiredBalance: 1000,
  maxOutputTokens: 2000,
  contextWindowTokens: 64000,
  sortOrder: 10
};

function stub(t: TestContext, target: object, key: string, replacement: unknown) {
  const original = Reflect.get(target, key);
  Reflect.set(target, key, replacement);
  t.after(() => { Reflect.set(target, key, original); });
}

async function buildApp() {
  const app = Fastify();
  app.decorate("authenticateUser", async (request: { user?: unknown }) => { request.user = { id: "user-1" }; });
  await app.register(modelRoutes);
  return app;
}

test("returns only Gangram models before a user connects Toking", async (t) => {
  stub(t, prisma.user, "findUniqueOrThrow", async () => ({
    id: "user-1",
    tokingApiKeyEncrypted: null,
    tokingBaseUrl: null,
    tokingCreditsExhausted: false,
    tokingBalance: null
  }));
  stub(t, prisma.llmModel, "findMany", async () => [localModel]);

  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({ url: "/models" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().models.map((model: { id: string }) => model.id), ["gangram-model"]);
});

test("switches a depleted Toking wallet to the Gangram catalog", async (t) => {
  const encryptedKey = encryptCredential("tk_live_customer_secret");
  const originalFetch = globalThis.fetch;
  let markedExhausted: unknown;
  stub(t, prisma.user, "findUniqueOrThrow", async () => ({
    id: "user-1",
    tokingApiKeyEncrypted: encryptedKey,
    tokingBaseUrl: "https://api.toking.test/v1",
    tokingCreditsExhausted: false,
    tokingBalance: "10"
  }));
  stub(t, prisma.user, "update", async (input: unknown) => { markedExhausted = input; return {}; });
  stub(t, prisma.llmModel, "findMany", async () => [localModel]);
  globalThis.fetch = async () => Response.json({
    postedBalance: "0",
    reservedBalance: "0",
    availableBalance: "0",
    canReserve: false,
    status: "active"
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({ url: "/models" });

  assert.deepEqual(response.json().models.map((model: { id: string }) => model.id), ["gangram-model"]);
  assert.deepEqual(markedExhausted, {
    where: { id: "user-1" },
    data: { tokingBalance: "0", tokingCreditsExhausted: true }
  });
});

test("returns only Toking models while the gift-card wallet can reserve", async (t) => {
  const encryptedKey = encryptCredential("tk_live_customer_secret");
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  stub(t, prisma.user, "findUniqueOrThrow", async () => ({
    id: "user-1",
    tokingApiKeyEncrypted: encryptedKey,
    tokingBaseUrl: "https://api.toking.test/v1",
    tokingCreditsExhausted: false,
    tokingBalance: "5000"
  }));
  stub(t, prisma.llmModel, "findMany", async () => [localModel]);
  stub(t, prisma.llmModel, "upsert", async ({ create }: { create: Record<string, unknown> }) => ({
    ...localModel,
    ...create,
    displayNameZh: null,
    modelSeriesName: null,
    modelSeriesNameZh: null,
    logoUrl: null
  }));
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).endsWith("/wallet")) {
      return Response.json({ postedBalance: "5000", reservedBalance: "0", availableBalance: "5000", canReserve: true, status: "active" });
    }
    return Response.json({
      object: "list",
      data: [{ id: "vendor/model", object: "model", created: 1, owned_by: "gangram", name: "Toking Model", context_length: 64000 }]
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({ url: "/models" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().models.length, 1);
  assert.equal(response.json().models[0].provider, "toking");
  assert.deepEqual(urls, ["https://api.toking.test/v1/wallet", "https://api.toking.test/v1/models"]);
});
