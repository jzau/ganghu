import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { decryptCredential, encryptCredential } from "../../lib/crypto.js";
import { env } from "../../lib/env.js";
import { prisma } from "../../lib/prisma.js";
import { redeemRoutes } from "./routes.js";

test("redeems through the persistent Toking client identity and saves the first customer key encrypted", async (t) => {
  const originalTransaction = prisma.$transaction;
  const originalFetch = globalThis.fetch;
  const originalClientKey = env.TOKING_CLIENT_API_KEY;
  const originalRedemptionUrl = env.TOKING_REDEMPTION_API_URL;
  Reflect.set(env, "TOKING_CLIENT_API_KEY", "tci_live_integration_secret");
  Reflect.set(env, "TOKING_REDEMPTION_API_URL", "https://credit.example.test/v1/client/gift-cards/redeem");

  let outbound: { url: string; headers: Headers; body: unknown } | undefined;
  let updateData: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, init) => {
    outbound = {
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body))
    };
    return Response.json({
      transactionId: "journal-1",
      creditAccountId: "account-1",
      walletCreated: true,
      credited: "2000",
      balanceAfter: "2000",
      baseUrl: "https://api.example.test/v1",
      modelsUrl: "https://api.example.test/v1/models",
      chatCompletionsUrl: "https://api.example.test/v1/chat/completions",
      apiKey: "tk_live_customer_secret",
      apiKeyPrefix: "tk_live_customer"
    });
  };
  const tx = {
    $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
    user: {
      findUniqueOrThrow: async () => ({
        id: "gangram-user-1",
        tokingCreditAccountId: null,
        tokingApiKeyEncrypted: null
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => { updateData = data; }
    }
  };
  Reflect.set(prisma, "$transaction", async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  t.after(() => {
    Reflect.set(prisma, "$transaction", originalTransaction);
    globalThis.fetch = originalFetch;
    Reflect.set(env, "TOKING_CLIENT_API_KEY", originalClientKey);
    Reflect.set(env, "TOKING_REDEMPTION_API_URL", originalRedemptionUrl);
  });

  const app = Fastify();
  app.decorate("authenticateUser", async (request: { user?: unknown }) => { request.user = { id: "gangram-user-1" }; });
  await app.register(redeemRoutes);
  t.after(() => app.close());

  const response = await app.inject({ method: "POST", url: "/redeem", payload: { code: "tk12345678901234" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    transactionId: "journal-1",
    walletCreated: true,
    credited: "2000",
    balanceAfter: "2000",
    connected: true
  });
  assert.equal(outbound?.url, "https://credit.example.test/v1/client/gift-cards/redeem");
  assert.equal(outbound?.headers.get("authorization"), "Bearer tci_live_integration_secret");
  assert.equal(outbound?.headers.get("idempotency-key")?.length, 64);
  assert.deepEqual(outbound?.body, { code: "TK12345678901234", externalUserId: "gangram-user-1" });
  assert.equal(updateData?.tokingCreditAccountId, "account-1");
  assert.equal(updateData?.tokingBaseUrl, "https://api.example.test/v1");
  assert.equal(updateData?.tokingBalance, "2000");
  assert.equal(updateData?.tokingCreditsExhausted, false);
  assert.equal(decryptCredential(String(updateData?.tokingApiKeyEncrypted)), "tk_live_customer_secret");
});

test("a later redemption preserves the saved customer key while topping up the same account", async (t) => {
  const originalTransaction = prisma.$transaction;
  const originalFetch = globalThis.fetch;
  const originalClientKey = env.TOKING_CLIENT_API_KEY;
  Reflect.set(env, "TOKING_CLIENT_API_KEY", "tci_live_integration_secret");
  let updateData: Record<string, unknown> | undefined;
  globalThis.fetch = async () => Response.json({
    transactionId: "journal-2",
    creditAccountId: "account-1",
    walletCreated: false,
    credited: "3000",
    balanceAfter: "5000",
    baseUrl: "https://api.example.test/v1",
    modelsUrl: "https://api.example.test/v1/models",
    chatCompletionsUrl: "https://api.example.test/v1/chat/completions"
  });
  const savedKey = encryptCredential("tk_live_existing");
  const tx = {
    $queryRaw: async () => [],
    user: {
      findUniqueOrThrow: async () => ({ id: "gangram-user-1", tokingCreditAccountId: "account-1", tokingApiKeyEncrypted: savedKey }),
      update: async ({ data }: { data: Record<string, unknown> }) => { updateData = data; }
    }
  };
  Reflect.set(prisma, "$transaction", async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
  t.after(() => {
    Reflect.set(prisma, "$transaction", originalTransaction);
    globalThis.fetch = originalFetch;
    Reflect.set(env, "TOKING_CLIENT_API_KEY", originalClientKey);
  });

  const app = Fastify();
  app.decorate("authenticateUser", async (request: { user?: unknown }) => { request.user = { id: "gangram-user-1" }; });
  await app.register(redeemRoutes);
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/redeem", payload: { code: "TKABCDEFGHIJKLMN" } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().balanceAfter, "5000");
  assert.equal(updateData?.tokingCreditAccountId, "account-1");
  assert.equal(updateData?.tokingCreditsExhausted, false);
  assert.equal("tokingApiKeyEncrypted" in (updateData ?? {}), false);
});
