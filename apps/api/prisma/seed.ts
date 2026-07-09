import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: new URL("../../../.env", import.meta.url).pathname });

const prisma = new PrismaClient();

await prisma.llmModel.upsert({
  where: { id: "seed-deepseek-chat" },
  create: {
    id: "seed-deepseek-chat",
    displayName: "DeepSeek Chat",
    displayNameZh: "深度求索聊天",
    provider: "openrouter",
    providerModelId: "deepseek/deepseek-chat",
    enabled: true,
    inputAppTokensPer1k: 1000,
    outputAppTokensPer1k: 2000,
    minimumRequiredBalance: 1000,
    maxOutputTokens: 2000,
    contextWindowTokens: 64000,
    sortOrder: 10
  },
  update: {
    displayName: "DeepSeek Chat",
    displayNameZh: "深度求索聊天",
    providerModelId: "deepseek/deepseek-chat",
    sortOrder: 10
  }
});

await prisma.llmModel.upsert({
  where: { id: "seed-kimi-k2" },
  create: {
    id: "seed-kimi-k2",
    displayName: "Kimi",
    displayNameZh: "Kimi",
    provider: "openrouter",
    providerModelId: "moonshotai/kimi-k2",
    enabled: true,
    inputAppTokensPer1k: 1000,
    outputAppTokensPer1k: 2000,
    minimumRequiredBalance: 1000,
    maxOutputTokens: 2000,
    contextWindowTokens: 128000,
    sortOrder: 20
  },
  update: {
    displayName: "Kimi",
    displayNameZh: "Kimi",
    providerModelId: "moonshotai/kimi-k2",
    sortOrder: 20
  }
});

await prisma.$disconnect();
