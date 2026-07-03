import type { FastifyPluginAsync } from "fastify";
import { toModelDto } from "../../lib/mapper.js";
import { prisma } from "../../lib/prisma.js";

export const modelRoutes: FastifyPluginAsync = async (app) => {
  app.get("/models", { preHandler: app.authenticateUser }, async () => {
    const models = await prisma.llmModel.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }]
    });
    return { models: models.map(toModelDto) };
  });
};
