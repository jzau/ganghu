import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { encryptCredential } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { tokingRoutes } from "./routes.js";

test("proxies wallet reads with the saved customer key and never exposes it", async (t) => {
  const originalFindUnique = prisma.user.findUnique;
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; authorization: string | null }> = [];

  Reflect.set(prisma.user, "findUnique", async () => ({
    tokingApiKeyEncrypted: encryptCredential("tk_live_customer_secret"),
    tokingBaseUrl: "https://api.toking.test/v1"
  }));
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
    return Response.json({
      postedBalance: "1880",
      reservedBalance: "0",
      availableBalance: "1880",
      canReserve: true,
      status: "active"
    });
  };
  t.after(() => {
    Reflect.set(prisma.user, "findUnique", originalFindUnique);
    globalThis.fetch = originalFetch;
  });

  const app = Fastify();
  app.decorate("authenticateUser", async (request: { user?: unknown }) => { request.user = { id: "user-1" }; });
  await app.register(tokingRoutes);
  t.after(() => app.close());

  const response = await app.inject({ url: "/wallet" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.json(), {
    postedBalance: "1880",
    reservedBalance: "0",
    availableBalance: "1880",
    canReserve: true,
    status: "active"
  });
  assert.deepEqual(requests, [{
    url: "https://api.toking.test/v1/wallet",
    authorization: "Bearer tk_live_customer_secret"
  }]);
  assert.doesNotMatch(response.body, /tk_live/);
});

test("forwards the opaque history cursor and returns only UI-safe transaction fields", async (t) => {
  const originalFindUnique = prisma.user.findUnique;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  Reflect.set(prisma.user, "findUnique", async () => ({
    tokingApiKeyEncrypted: encryptCredential("tk_live_customer_secret"),
    tokingBaseUrl: "https://api.toking.test/v1"
  }));
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return Response.json({
      data: [{
        transactionId: "transaction-1",
        type: "ai_credit_capture",
        sourceReference: "reservation-1",
        amount: "-120",
        metadata: { model: "gangram/vendor/model", provider: "private-provider", usage: { total_tokens: 42 } },
        task: null,
        postedAt: "2026-08-29T03:12:00.000Z"
      }, {
        transactionId: "transaction-2",
        type: "gift_card_redemption",
        sourceReference: "gift-card-1",
        amount: "2000",
        metadata: {},
        task: null,
        postedAt: "2026-08-28T03:12:00.000Z"
      }],
      nextCursor: "next/page+cursor"
    });
  };
  t.after(() => {
    Reflect.set(prisma.user, "findUnique", originalFindUnique);
    globalThis.fetch = originalFetch;
  });

  const app = Fastify();
  app.decorate("authenticateUser", async (request: { user?: unknown }) => { request.user = { id: "user-1" }; });
  await app.register(tokingRoutes);
  t.after(() => app.close());

  const response = await app.inject({ url: "/wallet/transactions?limit=10&cursor=previous%2Fpage%2Bcursor" });
  assert.equal(response.statusCode, 200);
  assert.equal(requestedUrl, "https://api.toking.test/v1/wallet/transactions?limit=10&cursor=previous%2Fpage%2Bcursor");
  assert.deepEqual(response.json(), {
    data: [{
      id: "transaction-1",
      type: "ai_credit_capture",
      amount: "-120",
      model: "gangram/vendor/model",
      createdAt: "2026-08-29T03:12:00.000Z"
    }, {
      id: "transaction-2",
      type: "gift_card_redemption",
      amount: "2000",
      model: null,
      createdAt: "2026-08-28T03:12:00.000Z"
    }],
    nextCursor: "next/page+cursor"
  });
  assert.doesNotMatch(response.body, /private-provider|total_tokens|reservation-1/);
});

test("requires a redeemed Toking connection", async (t) => {
  const originalFindUnique = prisma.user.findUnique;
  Reflect.set(prisma.user, "findUnique", async () => ({ tokingApiKeyEncrypted: null, tokingBaseUrl: null }));
  t.after(() => { Reflect.set(prisma.user, "findUnique", originalFindUnique); });

  const app = Fastify();
  app.decorate("authenticateUser", async (request: { user?: unknown }) => { request.user = { id: "user-1" }; });
  await app.register(tokingRoutes);
  t.after(() => app.close());

  const response = await app.inject({ url: "/wallet/transactions" });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, "TOKING_CONNECTION_REQUIRED");
});
