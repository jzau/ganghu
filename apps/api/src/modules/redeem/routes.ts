import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { encryptCredential } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import {
  normalizeGatewayBaseUrl,
  redeemTokingGiftCard,
  redemptionIdempotencyKey,
  TokingError,
  tokingHttpStatus
} from "../toking/client.js";

const redeemSchema = z.object({ code: z.string().trim().min(10).max(100) });

export const redeemRoutes: FastifyPluginAsync = async (app) => {
  app.post("/redeem", { preHandler: app.authenticateUser }, async (request, reply) => {
    const { code } = redeemSchema.parse(request.body);
    const normalizedCode = code.toUpperCase();
    const userId = request.user!.id;

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Serialize connection changes for this user. The remote request can be
        // replayed safely if the local transaction fails after Toking succeeds.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`toking-redemption:${userId}`}, 0))`;
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const redemption = await redeemTokingGiftCard({
          code: normalizedCode,
          externalUserId: user.id,
          idempotencyKey: redemptionIdempotencyKey(user.id, normalizedCode)
        });
        const baseUrl = normalizeGatewayBaseUrl(redemption.baseUrl);

        if (user.tokingCreditAccountId && user.tokingCreditAccountId !== redemption.creditAccountId) {
          throw new TokingError(409, "TOKING_ACCOUNT_MISMATCH", "Toking returned a different account for this user");
        }
        if (!user.tokingApiKeyEncrypted && !redemption.apiKey) {
          throw new TokingError(409, "TOKING_CREDENTIAL_RECOVERY_REQUIRED", "The Toking account exists but its API key is unavailable");
        }

        await tx.user.update({
          where: { id: user.id },
          data: {
            tokingCreditAccountId: redemption.creditAccountId,
            tokingBaseUrl: baseUrl,
            tokingBalance: redemption.balanceAfter,
            ...(redemption.apiKey ? {
              tokingApiKeyEncrypted: encryptCredential(redemption.apiKey),
              tokingApiKeyPrefix: redemption.apiKeyPrefix ?? null
            } : {})
          }
        });

        return {
          transactionId: redemption.transactionId,
          walletCreated: redemption.walletCreated,
          credited: redemption.credited,
          balanceAfter: redemption.balanceAfter,
          connected: true
        };
      }, { maxWait: 5_000, timeout: 25_000 });

      return result;
    } catch (error) {
      if (error instanceof TokingError) {
        request.log.warn({ code: error.code, status: error.status, user_id: userId }, "Toking gift-card redemption failed");
        return reply.code(tokingHttpStatus(error.status)).send({ code: error.code, message: error.message, retryable: error.retryable });
      }
      request.log.error({ err: error, user_id: userId }, "Toking gift-card redemption failed");
      return reply.code(500).send({ code: "REDEEM_FAILED", message: "Gift card could not be redeemed" });
    }
  });
};
