import type { FastifyPluginAsync } from "fastify";
import { toUserDto } from "../../lib/mapper.js";
import { prisma } from "../../lib/prisma.js";

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get("/me", { preHandler: app.authenticateUser }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    return { user: toUserDto(user) };
  });

  app.get("/me/balance", { preHandler: app.authenticateUser }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    return { appTokenBalance: user.appTokenBalance };
  });
};
