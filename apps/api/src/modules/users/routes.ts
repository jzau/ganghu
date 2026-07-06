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
};
