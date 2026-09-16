import type { FastifyPluginAsync } from "fastify";
import { toModelDto } from "../../lib/mapper.js";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../lib/env.js";

const defaultVisitorModels = [
  {
    id: "seed-deepseek-chat",
    displayName: "DeepSeek Chat",
    displayNameZh: "深度求索聊天",
    provider: "openrouter",
    providerModelId: "deepseek/deepseek-chat",
    enabled: true,
    inputAppTokensPer1k: 0,
    outputAppTokensPer1k: 0,
    minimumRequiredBalance: 0,
    maxOutputTokens: 2000,
    contextWindowTokens: 64000,
    sortOrder: 10
  },
  {
    id: "seed-kimi-k2",
    displayName: "Kimi",
    displayNameZh: "Kimi",
    provider: "openrouter",
    providerModelId: "moonshotai/kimi-k2",
    enabled: true,
    inputAppTokensPer1k: 0,
    outputAppTokensPer1k: 0,
    minimumRequiredBalance: 0,
    maxOutputTokens: 2000,
    contextWindowTokens: 128000,
    sortOrder: 20
  }
] as const;

export const modelRoutes: FastifyPluginAsync = async (app) => {
  app.get("/models", async (_request, reply) => {
    if (!env.VISITOR_CHAT_ENABLED) return reply.code(503).send({ code: "VISITOR_CHAT_DISABLED", message: "Visitor chat is unavailable" });
    return { models: await listVisitorModels() };
  });
};

async function listVisitorModels() {
  const query = {
    where: { enabled: true, provider: "openrouter" },
    orderBy: [{ sortOrder: "asc" as const }, { displayName: "asc" as const }]
  };
  let models = await prisma.llmModel.findMany(query);
  if (models.length === 0) {
    // An older installation may have only Toking models because that catalog
    // was synced from a wallet. Keep an intentional all-disabled state intact.
    const configuredCount = await prisma.llmModel.count({ where: { provider: "openrouter" } });
    if (configuredCount === 0) {
      await prisma.llmModel.createMany({ data: [...defaultVisitorModels], skipDuplicates: true });
      models = await prisma.llmModel.findMany(query);
    }
  }
  return models.map(toModelDto);
}
