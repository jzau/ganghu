import type { FastifyPluginAsync } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { env } from "../../lib/env.js";
import { toConversationDto, toMessageDto } from "../../lib/mapper.js";
import { prisma } from "../../lib/prisma.js";
import { buildAssistantInstructions } from "../context/assistant-instructions.js";
import { buildExternalSearchContext } from "../context/external-content.js";
import { estimateTokens, OpenRouterError, streamOpenRouterChat, type LlmChatMessage } from "../llm/openrouter.js";
import type { SearchResult } from "../search/contracts.js";
import { SearchError } from "../search/search-error.js";
import { planSearchAutomatically } from "../search/search-planner.js";
import { isPlatformSearchConfigured, resolveSearchMode, searchForMessage, searchForPlan } from "../search/search-service.js";

const createConversationSchema = z.object({ title: z.string().min(1).max(120).optional() });
const chatSchema = z.object({
  conversationId: z.string().optional(),
  modelId: z.string(),
  message: z.string().min(1).max(12000),
  searchMode: z.enum(["off", "explicit", "auto"]).optional()
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
    const searchMode = resolveSearchMode(input);
    const userId = request.user!.id;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const model = await prisma.llmModel.findFirst({ where: { id: input.modelId, enabled: true } });

    if (!model) return reply.code(404).send({ message: "Model not found" });
    if (model.provider !== "openrouter") {
      return reply.code(400).send({ message: "Only OpenRouter models are supported" });
    }
    if (searchMode === "explicit" && !isPlatformSearchConfigured()) {
      return reply.code(503).send({ message: "Web search is not configured. Add TAVILY_API_KEY on the server." });
    }
    if (user.appTokenBalance < model.minimumRequiredBalance) {
      return reply.code(402).send({ message: "Not enough app tokens" });
    }

    const conversation = input.conversationId
      ? await prisma.conversation.findFirst({ where: { id: input.conversationId, userId, deletedAt: null } })
      : await findOrCreateDraftConversation(userId, input.message);
    if (!conversation) return reply.code(404).send({ message: "Conversation not found" });

    const conversationModel = await prisma.message.findFirst({
      where: { conversationId: conversation.id, role: "assistant", modelId: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { modelId: true }
    });
    if (conversationModel?.modelId && conversationModel.modelId !== model.id) {
      return reply.code(409).send({ message: "Model cannot be changed after a conversation has started" });
    }

    const userMessage = await prisma.message.create({
      data: { conversationId: conversation.id, role: "user", content: input.message, modelId: model.id }
    });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    writeEvent(reply, "accepted", {
      conversation: toConversationDto(conversation),
      message: toMessageDto(userMessage)
    });
    const runId = nanoid();
    writeEvent(reply, "run_started", { runId, searchMode });

    const streamAbortController = new AbortController();
    reply.raw.once("close", () => streamAbortController.abort());
    const runDeadline = Date.now() + env.AGENT_RUN_TIMEOUT_MS;

    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: 80
    });
    history.reverse();
    const conversationMessages = history.map((message) => ({ role: message.role as LlmChatMessage["role"], content: message.content }));

    let partialAssistantContent = "";
    let searchResults: SearchResult[] = [];
    let searchCompleted = false;
    try {
      const plannerExecution = await planSearchAutomatically({
        message: input.message,
        recentMessages: conversationMessages,
        signal: streamAbortController.signal,
        deadline: runDeadline
      });
      const autoSearchPlan = plannerExecution.plan;
      request.log.info({
        run_id: runId,
        planner_source: plannerExecution.source,
        planner_model: plannerExecution.model,
        planner_duration_ms: plannerExecution.durationMs,
        planner_cost: plannerExecution.cost,
        planner_prompt_tokens: plannerExecution.promptTokens,
        planner_completion_tokens: plannerExecution.completionTokens,
        planner_fallback_reason: plannerExecution.fallbackReason,
        planner_needs_search: autoSearchPlan.needsSearch,
        planner_category: autoSearchPlan.category,
        planner_intent: autoSearchPlan.intent,
        planner_topic: autoSearchPlan.topic,
        planner_freshness: autoSearchPlan.freshness,
        planner_entities: autoSearchPlan.entities,
        planner_query_count: autoSearchPlan.queries?.length ?? 0,
        planner_queries: autoSearchPlan.queries,
        planner_confidence: autoSearchPlan.confidence
      }, "automatic search planned");
      const shouldSearch = isPlatformSearchConfigured() && (searchMode === "explicit" || (searchMode === "auto" && autoSearchPlan.needsSearch));
      if (shouldSearch) {
        const queryId = nanoid();
        const searchQuery = searchMode === "auto" ? autoSearchPlan.query! : input.message;
        writeEvent(reply, "search_started", { queryId, query: searchQuery });
        try {
          const search = searchMode === "auto"
            ? await searchForPlan({
              plan: autoSearchPlan,
              signal: streamAbortController.signal,
              deadline: runDeadline
            })
            : await searchForMessage({
              message: input.message,
              signal: streamAbortController.signal,
              deadline: runDeadline
            });
          searchResults = search.results;
          searchCompleted = true;
          writeEvent(reply, "search_results", { queryId, sources: searchResults });
          request.log.info({
            run_id: runId,
            search_provider: search.provider,
            search_result_count: searchResults.length,
            search_duration_ms: search.durationMs,
            search_request_id: search.requestId,
            search_cost: search.cost,
            search_retry_used: search.retryUsed,
            search_queries: search.queries,
            search_evidence: searchResults.map((result) => ({
              title: result.title.slice(0, 200),
              host: safeHostname(result.url),
              published_at: result.publishedAt,
              relevance_score: result.relevanceScore
            }))
          }, "web search completed");
        } catch (error) {
          if (searchMode === "explicit" || streamAbortController.signal.aborted) throw error;
          request.log.warn({ error, run_id: runId }, "automatic web search failed; continuing without search evidence");
        }
      }

      const assistantInstructions = buildAssistantInstructions(autoSearchPlan.category, autoSearchPlan.responseStyle);
      const externalContext = searchCompleted ? buildExternalSearchContext(searchResults) : undefined;
      const systemContextTokens = estimateTokens(assistantInstructions) + (externalContext ? estimateTokens(externalContext) : 0);
      const contextBudget = model.contextWindowTokens - model.maxOutputTokens;
      const llmMessages = trimMessages(
        conversationMessages,
        Math.max(1, contextBudget - systemContextTokens)
      );
      llmMessages.unshift({ role: "system", content: assistantInstructions });
      if (externalContext) llmMessages.splice(1, 0, { role: "system", content: externalContext });

      const stream = streamOpenRouterChat({
        model: model.providerModelId,
        messages: llmMessages,
        maxTokens: model.maxOutputTokens,
        signal: streamAbortController.signal
      });

      let result = await stream.next();
      while (!result.done) {
        partialAssistantContent += result.value.delta;
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
        run_id: runId,
        search_mode: searchMode,
        search_source_count: searchResults.length,
        prompt_tokens: result.value.usage.promptTokens,
        completion_tokens: result.value.usage.completionTokens,
        total_tokens: result.value.usage.totalTokens,
        deducted_app_tokens: totalCharge,
        response_time_ms: Date.now() - startedAt
      });

      writeEvent(reply, "done", {
        message: toMessageDto(assistantMessage),
        sources: searchResults,
        usage: {
          ...result.value.usage,
          totalAppTokensCharged: totalCharge,
          updatedBalance: updatedUser.appTokenBalance
        }
      });
      reply.raw.end();
    } catch (error) {
      if (streamAbortController.signal.aborted) {
        await persistStoppedResponse({
          conversationId: conversation.id,
          modelId: model.id,
          userMessage: input.message,
          partialAssistantContent
        });
        request.log.info(
          {
            user_id: userId,
            selected_model_id: model.id,
            conversation_id: conversation.id,
            partial_response_length: partialAssistantContent.length,
            response_time_ms: Date.now() - startedAt
          },
          "chat stream stopped by client"
        );
        return;
      }
      const chatError = toChatStreamError(error);
      await cleanupFailedUserMessage(conversation.id, userMessage.id).catch((cleanupError) => {
        request.log.error({ error: cleanupError, conversation_id: conversation.id, message_id: userMessage.id }, "failed to clean up failed chat message");
      });
      request.log.error(
        {
          error,
          user_id: userId,
          selected_model_id: model.id,
          provider: model.provider,
          provider_model_id: model.providerModelId,
          run_id: runId,
          search_mode: searchMode,
          upstream_status: error instanceof OpenRouterError ? error.status : undefined,
          upstream_message: error instanceof OpenRouterError ? error.providerMessage : undefined,
          search_error_code: error instanceof SearchError ? error.code : undefined
        },
        "chat stream failed"
      );
      writeEvent(reply, "error", chatError);
      reply.raw.end();
    }
  });
};

async function persistStoppedResponse(input: {
  conversationId: string;
  modelId: string;
  userMessage: string;
  partialAssistantContent: string;
}) {
  await prisma.$transaction(async (tx) => {
    if (input.partialAssistantContent.trim()) {
      await tx.message.create({
        data: {
          conversationId: input.conversationId,
          role: "assistant",
          content: input.partialAssistantContent,
          modelId: input.modelId
        }
      });
    }
    const conversation = await tx.conversation.findUniqueOrThrow({ where: { id: input.conversationId } });
    await tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        updatedAt: new Date(),
        title: defaultConversationTitles.has(conversation.title) ? input.userMessage.slice(0, 80) : conversation.title
      }
    });
  });
}

async function cleanupFailedUserMessage(conversationId: string, userMessageId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.message.deleteMany({ where: { id: userMessageId } });
    const remainingMessages = await tx.message.count({ where: { conversationId } });
    if (remainingMessages === 0) {
      await tx.conversation.update({
        where: { id: conversationId },
        data: { title: "New chat", updatedAt: new Date() }
      });
    }
  });
}

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

function safeHostname(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "invalid-url";
  }
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
  if (error instanceof SearchError) {
    return {
      code: `SEARCH_${error.code.toUpperCase()}`,
      message: friendlySearchMessage(error),
      retryable: error.retryable
    };
  }
  if (error instanceof OpenRouterError) {
    return {
      code: "OPENROUTER_REQUEST_FAILED",
      message: friendlyOpenRouterMessage(error)
    };
  }

  return { code: "CHAT_STREAM_FAILED", message: "Chat failed" };
}

function friendlySearchMessage(error: SearchError) {
  if (error.code === "authentication" || error.code === "not_configured") return "Web search is not configured correctly.";
  if (error.code === "rate_limited") return "Web search is rate limited. Please try again shortly.";
  if (error.code === "timeout") return "Web search timed out. Please try again.";
  if (error.code === "cancelled") return "Web search was cancelled.";
  return "Web search is temporarily unavailable. Please try again.";
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
