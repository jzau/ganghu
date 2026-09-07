import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { toUserDto } from "../../lib/mapper.js";
import { prisma } from "../../lib/prisma.js";

const updateMeSchema = z.object({
  displayName: z.string().trim().max(60).nullable().optional()
});

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", { preHandler: app.authenticateUser }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    return { user: toUserDto(user) };
  });

  app.patch("/me", { preHandler: app.authenticateUser }, async (request) => {
    const input = updateMeSchema.parse(request.body);
    const user = await prisma.user.update({
      where: { id: request.user!.id },
      data: { displayName: input.displayName?.trim() || null }
    });
    return { user: toUserDto(user) };
  });

  app.get("/me/balance", { preHandler: app.authenticateUser }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    return { appTokenBalance: user.appTokenBalance };
  });

  app.delete("/me", { preHandler: app.authenticateUser }, async (request, reply) => {
    const userId = request.user!.id;
    await prisma.$transaction(async (tx) => {
      await tx.chatUsageRecord.deleteMany({ where: { userId } });
      await tx.appTokenLedger.deleteMany({ where: { userId } });
      await tx.redeemCodeRedemption.deleteMany({ where: { userId } });
      await tx.conversation.deleteMany({ where: { userId } });
      await tx.userSession.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
    reply.clearCookie("user_session", { path: "/" });
    return { ok: true };
  });
};
