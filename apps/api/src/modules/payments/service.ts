import { Prisma, type PaymentOrder } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { paymentConfig } from "./config.js";
import { safeApprovalUrl, SharedPaymentGateway, type PaymentGateway, type RemotePayment } from "./gateway.js";

export class PaymentError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string) { super(code); }
}

export function verifyPayment(order: PaymentOrder, remote: RemotePayment) {
  if (remote.orderId !== order.id || remote.provider !== order.provider || remote.currency !== order.currency ||
      Math.abs(remote.amount * 100 - order.amountMinor) > 0.000001 ||
      (order.remotePaymentId !== null && remote.id !== order.remotePaymentId)) {
    throw new PaymentError(502, "PAYMENT_DETAILS_MISMATCH");
  }
}

export function orderDto(order: PaymentOrder) {
  return {
    id: order.id, offerId: order.offerId, methodId: order.methodId,
    amountMinor: order.amountMinor, currency: order.currency, appTokenAmount: order.appTokenAmount,
    status: order.status, approvalUrl: safeApprovalUrl(order.approvalUrl),
    createdAt: order.createdAt.toISOString(), creditedAt: order.creditedAt?.toISOString() ?? null
  };
}

export class PaymentService {
  constructor(private readonly gateway: PaymentGateway = new SharedPaymentGateway()) {}

  async create(userId: string, input: { requestKey: string; offerId: string; methodId: string }) {
    // Return the original order even if the catalog has since changed.
    const prior = await prisma.paymentOrder.findUnique({ where: { userId_requestKey: { userId, requestKey: input.requestKey } } });
    if (prior) return this.checkRetry(prior, input);
    const config = paymentConfig();
    if (!config.enabled) throw new PaymentError(503, "PAYMENTS_UNAVAILABLE");
    const offer = config.offers.find((o) => o.id === input.offerId);
    const method = config.methods.find((m) => m.id === input.methodId);
    if (!offer || !method || !method.currencies.includes(offer.currency)) throw new PaymentError(400, "INVALID_PAYMENT_SELECTION");
    let order: PaymentOrder;
    try {
      order = await prisma.paymentOrder.create({ data: {
        userId, requestKey: input.requestKey, offerId: offer.id, methodId: method.id, provider: method.provider,
        amountMinor: offer.amountMinor, currency: offer.currency, appTokenAmount: offer.appTokenAmount
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const existing = await prisma.paymentOrder.findUniqueOrThrow({ where: { userId_requestKey: { userId, requestKey: input.requestKey } } });
      return this.checkRetry(existing, input);
    }
    try {
      // Never automatically retry creation: the current upstream creates gateway orders before its idempotency check.
      const remote = await this.gateway.create({ orderId: order.id, amount: order.amountMinor / 100, currency: order.currency, provider: order.provider });
      verifyPayment(order, remote);
      const approvalUrl = safeApprovalUrl(remote.approvalUrl);
      if (!approvalUrl) throw new PaymentError(502, "INVALID_CHECKOUT_URL");
      order = await prisma.paymentOrder.update({ where: { id: order.id }, data: {
        remotePaymentId: remote.id, approvalUrl, status: "pending"
      } });
    } catch {
      // An order may exist upstream even on timeout. Keep its local ID for manual reconciliation.
      await prisma.paymentOrder.updateMany({ where: { id: order.id, status: "creating" }, data: { status: "creation_unknown" } });
      order = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
    }
    return order;
  }

  private checkRetry(order: PaymentOrder, input: { offerId: string; methodId: string }) {
    if (order.offerId !== input.offerId || order.methodId !== input.methodId) throw new PaymentError(409, "PAYMENT_REQUEST_CONFLICT");
    return order;
  }

  async refresh(order: PaymentOrder) {
    if (!order.remotePaymentId) return order;
    const remote = await this.gateway.get(order.remotePaymentId);
    verifyPayment(order, remote);
    if (remote.status === "captured") {
      if (!order.userId) {
        return prisma.paymentOrder.update({ where: { id: order.id }, data: { status: "account_deleted_review" } });
      }
      await prisma.$transaction(async (tx) => {
        // Conditional row update serializes concurrent callbacks and browser polling.
        // The claim, balance increment and ledger entry all commit or roll back together.
        const claimed = await tx.paymentOrder.updateMany({
          where: { id: order.id, creditedAt: null, userId: { not: null }, status: { in: ["pending", "canceled"] } },
          data: { status: "captured", creditedAt: new Date() }
        });
        if (!claimed.count) return;
        const current = await tx.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
        const user = await tx.user.update({ where: { id: current.userId! }, data: { appTokenBalance: { increment: current.appTokenAmount } } });
        await tx.appTokenLedger.create({ data: {
          userId: user.id, type: "payment", amount: current.appTokenAmount, balanceAfter: user.appTokenBalance,
          sourceType: "payment_order", sourceId: current.id,
          metadata: { provider: current.provider, amountMinor: current.amountMinor, currency: current.currency }
        } });
      });
    } else if (remote.status === "refunded") {
      // Shared API lacks reliable partial-refund amounts; never guess a balance reversal.
      await prisma.$transaction(async (tx) => {
        // Lock the order before examining creditedAt so a simultaneous capture cannot hide the refund.
        const current = await tx.paymentOrder.update({ where: { id: order.id }, data: { status: "refund_review" } });
        if (!current.creditedAt) await tx.paymentOrder.update({ where: { id: order.id }, data: { status: "refunded" } });
      });
    } else if (["canceled", "cancelled", "expired", "failed"].includes(remote.status)) {
      await prisma.paymentOrder.updateMany({ where: { id: order.id, creditedAt: null, status: "pending" }, data: { status: "canceled" } });
    }
    return prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
  }
}
