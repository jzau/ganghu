import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../lib/env.js";
import { paymentRoutes } from "./routes.js";
import { PaymentService } from "./service.js";
import type { PaymentGateway, RemotePayment } from "./gateway.js";

// Intentionally opt-in: never run destructive cleanup against the application's database.
const enabled = process.env.PAYMENT_INTEGRATION_TEST === "true";
test("payment orders, ownership, verification and atomic balance accounting (PostgreSQL)", { skip: !enabled }, async (t) => {
  assert.match(new URL(env.DATABASE_URL).pathname, /\/chatbot_payment_test$/);
  const original = { ...env };
  t.after(() => { Object.assign(env, original); });
  Object.assign(env, {
    PAYMENT_SERVICE_ENABLED: true,
    PAYMENT_SERVICE_BASE_URL: "https://payments.test",
    PAYMENT_PUBLIC_API_URL: "https://chat.test",
    PAYMENT_SERVICE_INTERNAL_SECRET: "internal-test",
    PAYMENT_CALLBACK_SECRET: "callback-test",
    PAYMENT_OFFERS_JSON: JSON.stringify([{ id: "small", amountMinor: 1000, currency: "USD", appTokenAmount: 5000 }]),
    PAYMENT_METHODS_JSON: JSON.stringify([{ id: "omi", label: "OmiPay", labelZh: "OmiPay", provider: "omipay", currencies: ["USD"] }])
  });
  const user = await prisma.user.create({ data: { phoneNumber: `test-${randomUUID()}`, appTokenBalance: 100 } });
  t.after(async () => {
    await prisma.appTokenLedger.deleteMany({ where: { userId: user.id } });
    await prisma.paymentOrder.deleteMany({ where: { requestKey: { startsWith: "test-" } } });
    await prisma.paymentOrder.deleteMany({ where: { userId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });
  const remote = new Map<string, RemotePayment>();
  let creations = 0;
  const gateway: PaymentGateway = {
    create: async (input) => {
      creations++;
      const result = { ...input, id: randomUUID(), status: "created", approvalUrl: "https://checkout.test/pay" };
      remote.set(result.id, result);
      return result;
    },
    get: async (id) => structuredClone(remote.get(id)!)
  };
  const service = new PaymentService(gateway);
  const input = () => ({ requestKey: randomUUID(), offerId: "small", methodId: "omi" });
  const newOrder = () => service.create(user.id, input());

  await t.test("concurrent duplicate creation calls the gateway once and freezes server prices", async () => {
    const request = input();
    const before = creations;
    const results = await Promise.all(Array.from({ length: 8 }, () => service.create(user.id, request)));
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    assert.equal(creations - before, 1);
    assert.equal(results[0].amountMinor, 1000);
    assert.equal(results[0].appTokenAmount, 5000);
    await assert.rejects(() => service.create(user.id, { ...request, methodId: "changed" }), /PAYMENT_REQUEST_CONFLICT/);
  });

  await t.test("pending is not creditable, and simultaneous captures create exactly one ledger entry", async () => {
    const order = await newOrder();
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).appTokenBalance;
    await service.refresh(order);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).appTokenBalance, before);
    remote.get(order.remotePaymentId!)!.status = "captured";
    await Promise.all(Array.from({ length: 12 }, () => service.refresh(order)));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).appTokenBalance, before + 5000);
    assert.equal(await prisma.appTokenLedger.count({ where: { sourceId: order.id } }), 1);
    assert.ok((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).creditedAt);
  });

  await t.test("mismatched amounts cannot credit a balance", async () => {
    const order = await newOrder();
    const result = remote.get(order.remotePaymentId!)!;
    result.status = "captured"; result.amount = 1;
    await assert.rejects(() => service.refresh(order), /PAYMENT_DETAILS_MISMATCH/);
    assert.equal(await prisma.appTokenLedger.count({ where: { sourceId: order.id } }), 0);
  });

  await t.test("ledger failure rolls back the balance increment and capture claim", async () => {
    const order = await newOrder();
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).appTokenBalance;
    remote.get(order.remotePaymentId!)!.status = "captured";
    // A temporary database trigger exercises actual transaction rollback, not a mock transaction.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION payment_test_reject_ledger() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test ledger failure'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER payment_test_reject BEFORE INSERT ON app_token_ledger FOR EACH ROW EXECUTE FUNCTION payment_test_reject_ledger()`);
    try { await assert.rejects(() => service.refresh(order)); }
    finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER payment_test_reject ON app_token_ledger`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION payment_test_reject_ledger()`);
    }
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).appTokenBalance, before);
    assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).creditedAt, null);
    await service.refresh(order);
    assert.equal(await prisma.appTokenLedger.count({ where: { sourceId: order.id } }), 1);
  });

  await t.test("ambiguous upstream creation is saved and never automatically retried", async () => {
    let attempts = 0;
    const failing = new PaymentService({ ...gateway, create: async () => { attempts++; throw new Error("timeout"); } });
    const request = input();
    const order = await failing.create(user.id, request);
    assert.equal(order.status, "creation_unknown");
    assert.equal((await failing.create(user.id, request)).id, order.id);
    assert.equal(attempts, 1);
  });

  await t.test("refund before capture prevents late capture; refund after credit requires review", async () => {
    const order = await newOrder();
    remote.get(order.remotePaymentId!)!.status = "refunded";
    await service.refresh(order);
    remote.get(order.remotePaymentId!)!.status = "captured";
    await service.refresh(order);
    assert.equal(await prisma.appTokenLedger.count({ where: { sourceId: order.id } }), 0);
    const paid = await newOrder();
    remote.get(paid.remotePaymentId!)!.status = "captured";
    await service.refresh(paid);
    remote.get(paid.remotePaymentId!)!.status = "refunded";
    assert.equal((await service.refresh(paid)).status, "refund_review");
    assert.equal(await prisma.appTokenLedger.count({ where: { sourceId: paid.id } }), 1);
  });

  await t.test("deleted accounts retain audit orders and cannot receive tokens", async () => {
    const deletedUser = await prisma.user.create({ data: { phoneNumber: `test-${randomUUID()}` } });
    const order = await service.create(deletedUser.id, input());
    await prisma.user.delete({ where: { id: deletedUser.id } });
    const saved = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(saved.userId, null);
    remote.get(order.remotePaymentId!)!.status = "captured";
    assert.equal((await service.refresh(saved)).status, "account_deleted_review");
    assert.equal(await prisma.appTokenLedger.count({ where: { sourceId: order.id } }), 0);
    await prisma.paymentOrder.delete({ where: { id: order.id } });
  });

  await t.test("routes reject unauthorized access, client pricing and forged callbacks; callbacks re-query", async () => {
    const mock = t.mock.method(globalThis, "fetch", async (url: string) => new Response(JSON.stringify(remote.get(url.split("/").at(-1)!))));
    const app = Fastify();
    app.decorate("authenticateUser", async (request, reply) => {
      if (request.headers["x-test-user"] !== user.id) { await reply.code(401).send({ message: "Unauthorized" }); return; }
      request.user = { id: user.id };
    });
    await app.register(paymentRoutes, { prefix: "/api/payments" });
    t.after(() => app.close());
    const headers = { "x-test-user": user.id };
    const order = await newOrder();
    assert.equal((await app.inject({ url: "/api/payments/orders" })).statusCode, 401);
    assert.equal((await app.inject({ url: "/api/payments/orders", method: "POST", headers, payload: { ...input(), amount: 0.01 } })).statusCode, 400);
    assert.equal((await app.inject({ url: "/api/payments/orders/other/refresh", method: "POST", headers })).statusCode, 404);
    const otherUser = await prisma.user.create({ data: { phoneNumber: `test-${randomUUID()}` } });
    const otherOrder = await service.create(otherUser.id, input());
    assert.equal((await app.inject({ url: `/api/payments/orders/${otherOrder.id}/refresh`, method: "POST", headers })).statusCode, 404);
    await prisma.paymentOrder.delete({ where: { id: otherOrder.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
    const payload = { orderId: order.id, paymentId: order.remotePaymentId, status: "captured", amount: 10 };
    assert.equal((await app.inject({ url: "/api/payments/callback", method: "POST", payload })).statusCode, 401);
    const callbackHeaders = { authorization: "Bearer callback-test" };
    assert.equal((await app.inject({ url: "/api/payments/callback", method: "POST", headers: callbackHeaders, payload })).statusCode, 200);
    assert.equal(await prisma.appTokenLedger.count({ where: { sourceId: order.id } }), 0);
    remote.get(order.remotePaymentId!)!.status = "captured";
    const response = await app.inject({ url: "/api/payments/callback", method: "POST", headers: callbackHeaders, payload });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(await prisma.appTokenLedger.count({ where: { sourceId: order.id } }), 1);
    assert.equal(mock.mock.callCount(), 2);
    mock.mock.restore();
    await app.close();
  });
});
