import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../../lib/env.js";
import { prisma } from "../../lib/prisma.js";
import { paymentConfig } from "./config.js";
import { orderDto, PaymentError, PaymentService } from "./service.js";

const createSchema = z.object({ requestKey: z.string().uuid(), offerId: z.string().min(1).max(64), methodId: z.string().min(1).max(64) }).strict();
const callbackSchema = z.object({ orderId: z.string().min(1).max(128), paymentId: z.string().min(1).max(128) });

export function validCallbackAuth(header: string | undefined) {
  const expected = Buffer.from(`Bearer ${env.PAYMENT_CALLBACK_SECRET}`);
  const actual = Buffer.from(header ?? "");
  return Boolean(env.PAYMENT_CALLBACK_SECRET) && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  paymentConfig(); // Reject invalid enabled configuration on startup.
  const service = new PaymentService();
  // Recover missed callbacks without requiring the customer to keep a browser open.
  // Per-order claims in PaymentService make overlapping instances safe for crediting.
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", async () => {
    if (!env.PAYMENT_SERVICE_ENABLED) return;
    timer = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await prisma.paymentOrder.updateMany({
          where: { status: "creating", remotePaymentId: null, createdAt: { lt: new Date(Date.now() - 5 * 60_000) } },
          data: { status: "creation_unknown" }
        });
        const orders = await prisma.paymentOrder.findMany({
          where: { status: "pending", remotePaymentId: { not: null } },
          orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } }, take: 10
        });
        for (const order of orders) {
          try { await service.refresh(order); }
          catch { app.log.warn({ orderId: order.id }, "Payment reconciliation will retry"); }
          finally {
            await prisma.paymentOrder.update({ where: { id: order.id }, data: { lastCheckedAt: new Date() } });
          }
        }
      } catch { app.log.error("Payment reconciliation failed"); }
      finally { running = false; }
    }, 60_000);
    timer.unref();
  });
  app.addHook("onClose", async () => { if (timer) clearInterval(timer); });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ code: "INVALID_PAYMENT_REQUEST" });
    if (error instanceof PaymentError) return reply.code(error.statusCode).send({ code: error.code });
    if (error.statusCode && [400, 413, 429].includes(error.statusCode)) {
      return reply.code(error.statusCode).send({ code: error.statusCode === 429 ? "PAYMENT_RATE_LIMITED" : "INVALID_PAYMENT_REQUEST" });
    }
    // Do not log gateway payloads, checkout URLs or credentials.
    request.log.error({ requestId: request.id }, "Payment operation failed");
    return reply.code(502).send({ code: "PAYMENT_SERVICE_UNAVAILABLE" });
  });

  app.get("/catalog", { preHandler: app.authenticateUser }, async () => {
    const config = paymentConfig();
    return config.enabled ? config : { enabled: false, offers: [], methods: [] };
  });

  app.get("/orders", { preHandler: app.authenticateUser }, async (request) => {
    const orders = await prisma.paymentOrder.findMany({ where: { userId: request.user!.id }, orderBy: { createdAt: "desc" }, take: 50 });
    return { orders: orders.map(orderDto) };
  });

  app.get("/ledger", { preHandler: app.authenticateUser }, async (request) => {
    const entries = await prisma.appTokenLedger.findMany({
      where: { userId: request.user!.id }, orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, type: true, amount: true, balanceAfter: true, createdAt: true }
    });
    return { entries };
  });

  app.post("/orders", { preHandler: app.authenticateUser, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const input = createSchema.parse(request.body);
    return { order: orderDto(await service.create(request.user!.id, input)) };
  });

  app.post("/orders/:id/refresh", { preHandler: app.authenticateUser, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const { id } = z.object({ id: z.string().max(128) }).parse(request.params);
    const order = await prisma.paymentOrder.findFirst({ where: { id, userId: request.user!.id } });
    if (!order) throw new PaymentError(404, "PAYMENT_ORDER_NOT_FOUND");
    return { order: orderDto(await service.refresh(order)) };
  });

  app.post("/callback", async (request, reply) => {
    if (!validCallbackAuth(request.headers.authorization)) return reply.code(401).send({ code: "INVALID_PAYMENT_CALLBACK" });
    const input = callbackSchema.parse(request.body);
    const order = await prisma.paymentOrder.findUnique({ where: { id: input.orderId } });
    if (!order) throw new PaymentError(404, "PAYMENT_ORDER_NOT_FOUND");
    if (!order.remotePaymentId) throw new PaymentError(503, "PAYMENT_ORDER_NOT_READY");
    if (order.remotePaymentId !== input.paymentId) throw new PaymentError(409, "PAYMENT_DETAILS_MISMATCH");
    // Callbacks are wake-up signals only. Re-read amount, currency, provider and status server-to-server.
    await service.refresh(order);
    return { received: true };
  });
};
