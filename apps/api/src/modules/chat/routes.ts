import type { FastifyPluginAsync } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { toConversationDto, toMessageDto } from "../../lib/mapper.js";
import { prisma } from "../../lib/prisma.js";
import { estimateTokens, OpenRouterError, streamOpenRouterChat, type LlmChatMessage } from "../llm/openrouter.js";

const createConversationSchema = z.object({ title: z.string().min(1).max(120).optional() });
const chatSchema = z.object({
  conversationId: z.string().optional(),
  modelId: z.string(),
  message: z.string().min(1).max(12000)
});
const defaultConversationTitles = new Set(["New chat", "新建对话"]);

export const chatRoutes: FastifyPluginAsync = async (app) => {
  app.get("/conversations", { preHandler: app.authenticateUser }, async (request) => {
    const conversations = await prisma.conversation.findMany({
      where: { userId: request.user!.id, deletedAt: null },
      include: { _count: { select: { messages: true } } },
      orderBy: { updatedAt: "desc" }
    });
    return { conversations: conversations.map(toConversationDto) };
  });

  app.post("/conversations", { preHandler: app.authenticateUser }, async (request) => {
    const input = createConversationSchema.parse(request.body);
    const draftConversation = await prisma.conversation.findFirst({
      where: { userId: request.user!.id, deletedAt: null, messages: { none: {} } },
      include: { _count: { select: { messages: true } } },
      orderBy: { updatedAt: "desc" }
    });
    if (draftConversation) return { conversation: toConversationDto(draftConversation) };

    const conversation = await prisma.conversation.create({
      data: { userId: request.user!.id, title: input.title ?? "New chat" },
      include: { _count: { select: { messages: true } } }
    });
    return { conversation: toConversationDto(conversation) };
  });

  app.get("/conversations/:id/messages", { preHandler: app.authenticateUser }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const conversation = await prisma.conversation.findFirst({ where: { id, userId: request.user!.id, deletedAt: null } });
    if (!conversation) return reply.code(404).send({ message: "Conversation not found" });
    const messages = await prisma.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } });
    return { messages: messages.map(toMessageDto) };
  });

  app.post("/conversations/:id/share", { preHandler: app.authenticateUser }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const conversation = await prisma.conversation.findFirst({ where: { id, userId: request.user!.id, deletedAt: null } });
    if (!conversation) return reply.code(404).send({ message: "Conversation not found" });

    const share = await prisma.conversationShare.upsert({
      where: { conversationId: id },
      create: { conversationId: id, token: nanoid(32) },
      update: {}
    });
    return { token: share.token };
  });

  app.get("/shared/:token", async (request, reply) => {
    const { token } = z.object({ token: z.string().min(12).max(80) }).parse(request.params);
    const share = await prisma.conversationShare.findUnique({
      where: { token },
      include: { conversation: true }
    });
    if (!share || share.conversation.deletedAt) return reply.code(404).send({ message: "Shared conversation not found" });

    const messages = await prisma.message.findMany({
      where: { conversationId: share.conversationId, role: { in: ["user", "assistant"] } },
      orderBy: { createdAt: "asc" }
    });
    return {
      share: {
        token: share.token,
        conversation: toConversationDto(share.conversation),
        messages: messages.map(toMessageDto),
        createdAt: share.createdAt.toISOString()
      }
    };
  });

  app.delete("/conversations/:id", { preHandler: app.authenticateUser }, async (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const result = await prisma.conversation.updateMany({
      where: { id, userId: request.user!.id, deletedAt: null },
      data: { deletedAt: new Date() }
    });
    if (result.count === 0) return reply.code(404).send({ message: "Conversation not found" });
    return { ok: true };
  });

  app.post("/chat/stream", { preHandler: app.authenticateUser }, async (request, reply) => {
    const startedAt = Date.now();
    const input = chatSchema.parse(request.body);
    const userId = request.user!.id;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const model = await prisma.llmModel.findFirst({ where: { id: input.modelId, enabled: true } });

    if (!model) return reply.code(404).send({ message: "Model not found" });
    if (model.provider !== "openrouter") {
      return reply.code(400).send({ message: "Only OpenRouter models are supported" });
    }
    if (user.appTokenBalance < model.minimumRequiredBalance) {
      return reply.code(402).send({ message: "Not enough app tokens" });
    }

    const conversation = input.conversationId
      ? await prisma.conversation.findFirst({ where: { id: input.conversationId, userId, deletedAt: null } })
      : await findOrCreateDraftConversation(userId, input.message);
    if (!conversation) return reply.code(404).send({ message: "Conversation not found" });

    const conversationModel = await prisma.message.findFirst({
      where: { conversationId: conversation.id, modelId: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { modelId: true }
    });
    if (conversationModel?.modelId && conversationModel.modelId !== model.id) {
      return reply.code(409).send({ message: "Model cannot be changed after a conversation has started" });
    }

    const userMessage = await prisma.message.create({
      data: { conversationId: conversation.id, role: "user", content: input.message, modelId: model.id }
    });

    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: 80
    });
    history.reverse();
    const llmMessages = trimMessages(
      history.map((message) => ({ role: message.role as LlmChatMessage["role"], content: message.content })),
      model.contextWindowTokens - model.maxOutputTokens
    );

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    try {
      const stream = streamOpenRouterChat({
        model: model.providerModelId,
        messages: llmMessages,
        maxTokens: model.maxOutputTokens
      });

      let result = await stream.next();
      while (!result.done) {
        writeEvent(reply, "delta", { content: result.value.delta });
        result = await stream.next();
      }

      const assistantMessage = await prisma.message.create({
        data: { conversationId: conversation.id, role: "assistant", content: result.value.content, modelId: model.id }
      });
      const inputCharge = Math.ceil((result.value.usage.promptTokens / 1000) * model.inputAppTokensPer1k);
      const outputCharge = Math.ceil((result.value.usage.completionTokens / 1000) * model.outputAppTokensPer1k);
      const totalCharge = inputCharge + outputCharge;

      const updatedUser = await prisma.$transaction(async (tx) => {
        const freshUser = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        const nextBalance = Math.max(0, freshUser.appTokenBalance - totalCharge);
        const chargedAmount = freshUser.appTokenBalance - nextBalance;
        const updated = await tx.user.update({ where: { id: userId }, data: { appTokenBalance: nextBalance } });
        await tx.chatUsageRecord.create({
          data: {
            userId,
            conversationId: conversation.id,
            messageId: assistantMessage.id,
            modelId: model.id,
            provider: model.provider,
            providerModelId: model.providerModelId,
            promptTokens: result.value.usage.promptTokens,
            completionTokens: result.value.usage.completionTokens,
            totalTokens: result.value.usage.totalTokens,
            inputAppTokensCharged: inputCharge,
            outputAppTokensCharged: outputCharge,
            totalAppTokensCharged: totalCharge,
            openrouterGenerationId: result.value.generationId,
            openrouterCost: result.value.cost
          }
        });
        await tx.appTokenLedger.create({
          data: {
            userId,
            type: "chat_usage",
            amount: -chargedAmount,
            balanceAfter: nextBalance,
            sourceType: "message",
            sourceId: assistantMessage.id,
            metadata: { requestedCharge: totalCharge }
          }
        });
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date(), title: defaultConversationTitles.has(conversation.title) ? input.message.slice(0, 80) : conversation.title }
        });
        return updated;
      });

      request.log.info({
        user_id: userId,
        selected_model_id: model.id,
        provider_model_id: model.providerModelId,
        prompt_tokens: result.value.usage.promptTokens,
        completion_tokens: result.value.usage.completionTokens,
        total_tokens: result.value.usage.totalTokens,
        deducted_app_tokens: totalCharge,
        response_time_ms: Date.now() - startedAt
      });

      writeEvent(reply, "done", {
        message: toMessageDto(assistantMessage),
        usage: {
          ...result.value.usage,
          totalAppTokensCharged: totalCharge,
          updatedBalance: updatedUser.appTokenBalance
        }
      });
      reply.raw.end();
    } catch (error) {
      const chatError = toChatStreamError(error);
      request.log.error(
        {
          error,
          user_id: userId,
          selected_model_id: model.id,
          provider: model.provider,
          provider_model_id: model.providerModelId,
          upstream_status: error instanceof OpenRouterError ? error.status : undefined,
          upstream_message: error instanceof OpenRouterError ? error.providerMessage : undefined
        },
        "chat stream failed"
      );
      writeEvent(reply, "error", chatError);
      reply.raw.end();
    }
  });
};

async function findOrCreateDraftConversation(userId: string, message: string) {
  const draftConversation = await prisma.conversation.findFirst({
    where: { userId, deletedAt: null, messages: { none: {} } },
    orderBy: { updatedAt: "desc" }
  });
  if (draftConversation) return draftConversation;

  return prisma.conversation.create({
    data: { userId, title: message.slice(0, 80) || "New chat" }
  });
}

function writeEvent(reply: { raw: NodeJS.WritableStream }, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function trimMessages(messages: LlmChatMessage[], maxTokens: number) {
  const kept: LlmChatMessage[] = [];
  let total = 0;
  for (const message of [...messages].reverse()) {
    const tokens = estimateTokens(message.content);
    if (total + tokens > maxTokens && kept.length > 0) break;
    kept.unshift(message);
    total += tokens;
  }
  return kept;
}

function toChatStreamError(error: unknown) {
  if (error instanceof OpenRouterError) {
    return {
      code: "OPENROUTER_REQUEST_FAILED",
      message: friendlyOpenRouterMessage(error)
    };
  }

  return { code: "CHAT_STREAM_FAILED", message: "Chat failed" };
}

function friendlyOpenRouterMessage(error: OpenRouterError) {
  const providerMessage = error.providerMessage?.replace(/\s+/g, " ").trim();
  if (error.status === 429) {
    return providerMessage ? `OpenRouter provider is rate limited: ${providerMessage}` : "OpenRouter provider is rate limited. Please try again shortly.";
  }
  if (error.status >= 500) {
    return providerMessage ? `OpenRouter provider is temporarily unavailable: ${providerMessage}` : `OpenRouter provider is temporarily unavailable (${error.status}).`;
  }
  if (providerMessage) return `OpenRouter error: ${providerMessage}`;
  return `OpenRouter request failed with status ${error.status}`;
}
