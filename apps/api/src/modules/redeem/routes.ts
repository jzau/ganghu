import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hashSecret } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";

const redeemSchema = z.object({ code: z.string().min(3).max(128) });

export const redeemRoutes: FastifyPluginAsync = async (app) => {
  app.post("/redeem", { preHandler: app.authenticateUser }, async (request, reply) => {
    const { code } = redeemSchema.parse(request.body);
    const userId = request.user!.id;
    const codeHash = hashSecret(code.trim().toUpperCase());

    try {
      const result = await prisma.$transaction(async (tx) => {
        const redeemCode = await tx.redeemCode.findUnique({ where: { codeHash } });
        if (!redeemCode) throw new Error("CODE_NOT_FOUND");
        if (!redeemCode.enabled) throw new Error("CODE_DISABLED");
        if (redeemCode.expiresAt && redeemCode.expiresAt < new Date()) throw new Error("CODE_EXPIRED");
        if (redeemCode.usageLimit !== null && redeemCode.usedCount >= redeemCode.usageLimit) {
          throw new Error("CODE_USED_UP");
        }

        const prior = await tx.redeemCodeRedemption.findUnique({
          where: { redeemCodeId_userId: { redeemCodeId: redeemCode.id, userId } }
        });
        if (prior) throw new Error("CODE_ALREADY_REDEEMED");

        const user = await tx.user.update({
          where: { id: userId },
          data: { appTokenBalance: { increment: redeemCode.appTokenAmount } }
        });

        const redemption = await tx.redeemCodeRedemption.create({
          data: { redeemCodeId: redeemCode.id, userId, appTokenAmount: redeemCode.appTokenAmount }
        });
        await tx.redeemCode.update({
          where: { id: redeemCode.id },
          data: { usedCount: { increment: 1 } }
        });
        await tx.appTokenLedger.create({
          data: {
            userId,
            type: "redeem",
            amount: redeemCode.appTokenAmount,
            balanceAfter: user.appTokenBalance,
            sourceType: "redeem_code_redemption",
            sourceId: redemption.id
          }
        });

        return { appTokenBalance: user.appTokenBalance, appTokenAmount: redeemCode.appTokenAmount };
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "REDEEM_FAILED";
      return reply.code(400).send({ code: message, message: "Redeem code could not be applied" });
    }
  });
};
