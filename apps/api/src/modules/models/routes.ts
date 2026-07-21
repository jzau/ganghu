import type { FastifyPluginAsync } from "fastify";
import { toModelDto } from "../../lib/mapper.js";
import { prisma } from "../../lib/prisma.js";
import { isPlatformSearchConfigured } from "../search/search-service.js";

export const modelRoutes: FastifyPluginAsync = async (app) => {
  app.get("/models", async () => {
    const models = await prisma.llmModel.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }]
    });
    const supportsWebSearch = isPlatformSearchConfigured();
    return { models: models.map((model) => toModelDto(model, { supportsWebSearch })) };
  });
};
