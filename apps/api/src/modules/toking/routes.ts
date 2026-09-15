import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import {
  getTokingWallet,
  listTokingWalletTransactions,
  readTokingConnection,
  TokingError,
  tokingHttpStatus
} from "./client.js";

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(1000).optional()
});

async function connectionForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokingApiKeyEncrypted: true, tokingBaseUrl: true }
  });
  const connection = user && readTokingConnection(user);
  if (!connection) throw new TokingError(409, "TOKING_CONNECTION_REQUIRED", "Redeem a Toking gift card first");
  return connection;
}

function sendTokingError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof TokingError) {
    return reply.code(tokingHttpStatus(error.status)).send({ code: error.code, message: error.message, retryable: error.retryable });
  }
  request.log.error({ requestId: request.id }, "Toking wallet read failed");
  return reply.code(502).send({ code: "TOKING_UNAVAILABLE", message: "Toking wallet is unavailable", retryable: true });
}

export const tokingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/wallet", { preHandler: app.authenticateUser }, async (request, reply) => {
    try {
      const connection = await connectionForUser(request.user!.id);
      const wallet = await getTokingWallet(connection);
      reply.header("Cache-Control", "no-store");
      return wallet;
    } catch (error) {
      return sendTokingError(error, request, reply);
    }
  });

  app.get("/wallet/transactions", { preHandler: app.authenticateUser }, async (request, reply) => {
    try {
      const query = historyQuerySchema.parse(request.query);
      const connection = await connectionForUser(request.user!.id);
      const history = await listTokingWalletTransactions({ ...connection, ...query });
      reply.header("Cache-Control", "no-store");
      return {
        data: history.data.map((transaction) => ({
          id: transaction.transactionId,
          type: transaction.type,
          amount: transaction.amount,
          model: typeof transaction.metadata.model === "string" ? transaction.metadata.model : null,
          createdAt: transaction.postedAt
        })),
        nextCursor: history.nextCursor
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({ code: "INVALID_TOKING_HISTORY_QUERY", message: "Invalid wallet history query" });
      }
      return sendTokingError(error, request, reply);
    }
  });
};
