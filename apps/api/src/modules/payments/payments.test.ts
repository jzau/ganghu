import assert from "node:assert/strict";
import test from "node:test";
import type { PaymentOrder } from "@prisma/client";
import { env } from "../../lib/env.js";
import { paymentConfig } from "./config.js";
import { safeApprovalUrl, SharedPaymentGateway } from "./gateway.js";
import { validCallbackAuth } from "./routes.js";
import { verifyPayment } from "./service.js";

test("checkout URLs reject script, plaintext and embedded credentials", () => {
  for (const url of ["javascript:alert(1)", "http://pay.example", "https://user:pass@pay.example", "//pay.example", "bad"]) {
    assert.equal(safeApprovalUrl(url), null);
  }
  assert.equal(safeApprovalUrl("https://pay.example/order"), "https://pay.example/order");
});

test("payment verification binds remote ID, order, amount, currency and provider", () => {
  const order = { id: "local", remotePaymentId: "remote", amountMinor: 1234, currency: "USD", provider: "omipay" } as PaymentOrder;
  const remote = { id: "remote", orderId: "local", amount: 12.34, currency: "USD", provider: "omipay", status: "captured" };
  assert.doesNotThrow(() => verifyPayment(order, remote));
  for (const change of [{ id: "other" }, { orderId: "other" }, { amount: 12.35 }, { currency: "CNY" }, { provider: "paypal" }]) {
    assert.throws(() => verifyPayment(order, { ...remote, ...change }), /PAYMENT_DETAILS_MISMATCH/);
  }
});

test("callback authentication fails closed and requires the exact bearer token", (t) => {
  const original = env.PAYMENT_CALLBACK_SECRET;
  t.after(() => { env.PAYMENT_CALLBACK_SECRET = original; });
  env.PAYMENT_CALLBACK_SECRET = "";
  assert.equal(validCallbackAuth("Bearer "), false);
  env.PAYMENT_CALLBACK_SECRET = "test-secret";
  assert.equal(validCallbackAuth(undefined), false);
  assert.equal(validCallbackAuth("Bearer wrong-token"), false);
  assert.equal(validCallbackAuth("Bearer test-secret"), true);
});

test("catalog rejects the upstream OmiPay currency bug and unsupported minor units", (t) => {
  const original = { ...env };
  t.after(() => Object.assign(env, original));
  env.PAYMENT_SERVICE_ENABLED = false;
  env.PAYMENT_OFFERS_JSON = "[]";
  env.PAYMENT_METHODS_JSON = JSON.stringify([{ id: "omi", label: "OmiPay", labelZh: "OmiPay", provider: "omipay", currencies: ["CNY"] }]);
  assert.throws(paymentConfig, /only accepts USD/);
  env.PAYMENT_METHODS_JSON = "[]";
  env.PAYMENT_OFFERS_JSON = JSON.stringify([{ id: "test", amountMinor: 100, currency: "JPY", appTokenAmount: 1000 }]);
  assert.throws(paymentConfig);
});

test("shared gateway sends one provider, internal auth, callback and stable key; never retries", async (t) => {
  const original = { ...env };
  t.after(() => Object.assign(env, original));
  env.PAYMENT_SERVICE_BASE_URL = "https://payments.example";
  env.PAYMENT_PUBLIC_API_URL = "https://chat.example";
  env.PAYMENT_SERVICE_INTERNAL_SECRET = "internal-test";
  const calls: { url: string; init?: RequestInit }[] = [];
  const gateway = new SharedPaymentGateway(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "remote", orderId: "order", amount: 10, currency: "USD", provider: "omipay", status: "created", approvalUrl: "https://pay.example" }));
  });
  await gateway.create({ orderId: "order", amount: 10, currency: "USD", provider: "omipay" });
  assert.equal(calls[0].url, "https://payments.example/api/payments");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("X-Internal-Auth"), "internal-test");
  assert.equal(headers.get("Idempotency-Key"), "chatbot:order");
  const body = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(body.providers, ["omipay"]);
  assert.equal(body.callbackUrl, "https://chat.example/api/payments/callback");
  let attempts = 0;
  const failing = new SharedPaymentGateway(async () => { attempts++; throw new Error("timeout"); });
  await assert.rejects(() => failing.create({ orderId: "order", amount: 10, currency: "USD", provider: "omipay" }));
  assert.equal(attempts, 1);
});
