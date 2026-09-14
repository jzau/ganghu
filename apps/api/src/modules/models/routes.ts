import type { FastifyPluginAsync } from "fastify";
import { createHash } from "node:crypto";
import { toModelDto } from "../../lib/mapper.js";
import { prisma } from "../../lib/prisma.js";
import { listTokingModels, readTokingConnection, TokingError, tokingHttpStatus, type TokingModel } from "../toking/client.js";

export const modelRoutes: FastifyPluginAsync = async (app) => {
  app.get("/models", { preHandler: app.authenticateUser }, async (request, reply) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    try {
      const connection = readTokingConnection(user);
      if (!connection) return { models: [] };
      const remoteModels = await listTokingModels(connection);
      const models = await Promise.all(remoteModels.map((model, index) => syncTokingModel(model, index)));
      return { models: models.map(toModelDto) };
    } catch (error) {
      if (error instanceof TokingError) {
        return reply.code(tokingHttpStatus(error.status)).send({ code: error.code, message: error.message, retryable: error.retryable });
      }
      throw error;
    }
  });
};

function syncTokingModel(model: TokingModel, sortOrder: number) {
  const id = `toking-${createHash("sha256").update(model.id).digest("hex").slice(0, 24)}`;
  const contextWindowTokens = Math.max(1_000, model.context_length ?? 128_000);
  const data = {
    displayName: model.name?.trim() || model.id.split("/").at(-1) || model.id,
    provider: "toking",
    providerModelId: model.id,
    enabled: true,
    inputAppTokensPer1k: 0,
    outputAppTokensPer1k: 0,
    minimumRequiredBalance: 0,
    maxOutputTokens: Math.min(4_096, contextWindowTokens - 1),
    contextWindowTokens,
    sortOrder
  };
  return prisma.llmModel.upsert({
    where: { id },
    create: { id, ...data },
    update: data
  });
}
