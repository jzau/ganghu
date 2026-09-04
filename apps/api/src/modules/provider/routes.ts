import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../lib/env.js";
import { verifyPlainText } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";

const requestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.record(z.unknown())).min(1),
  stream: z.boolean().optional().default(false),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  stream_options: z.record(z.unknown()).optional()
}).passthrough();

const completionSchema = z.object({
  id: z.string().min(1),
  object: z.literal("chat.completion"),
  created: z.number().int().nonnegative(),
  model: z.string().min(1),
  choices: z.array(z.object({
    index: z.number().int().nonnegative(),
    message: z.object({ role: z.string(), content: z.unknown().optional() }).passthrough(),
    finish_reason: z.unknown().optional()
  }).passthrough()),
  usage: z.record(z.unknown()).nullable().optional()
}).passthrough();

const chunkSchema = z.object({
  id: z.string().min(1),
  object: z.literal("chat.completion.chunk"),
  created: z.number().int().nonnegative(),
  model: z.string().min(1),
  choices: z.array(z.object({
    index: z.number().int().nonnegative(),
    delta: z.record(z.unknown()),
    finish_reason: z.unknown().optional()
  }).passthrough()),
  usage: z.record(z.unknown()).nullable().optional()
}).passthrough();

type ProviderModel = {
  providerModelId: string;
  displayName: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  createdAt: Date;
};

type ProviderRouteOptions = {
  listModels?: () => Promise<ProviderModel[]>;
  findModel?: (id: string) => Promise<ProviderModel | null>;
  fetchImpl?: typeof fetch;
  apiKeys?: string[];
  upstreamApiKey?: string;
  upstreamBaseUrl?: string;
};

function configuredKeys() {
  return env.TOKING_PROVIDER_API_KEYS.split(",").map((key) => key.trim()).filter(Boolean);
}

function bearerToken(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function providerError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message, param: null, type: status >= 500 ? "server_error" : "invalid_request_error" } });
}

function errorPayload(code: string, message: string) {
  return { error: { code, message, param: null, type: "server_error" } };
}

function estimatedTokens(value: unknown) {
  return Math.max(1, Math.ceil(JSON.stringify(value ?? "").length / 4));
}

function boundedRequest(input: z.infer<typeof requestSchema>, model: ProviderModel) {
  const body: Record<string, unknown> = { ...input, model: model.providerModelId, usage: { include: true } };
  if (input.max_completion_tokens !== undefined) {
    body.max_completion_tokens = Math.min(input.max_completion_tokens, model.maxOutputTokens);
    delete body.max_tokens;
  } else {
    body.max_tokens = Math.min(input.max_tokens ?? model.maxOutputTokens, model.maxOutputTokens);
  }
  if (input.stream) {
    body.stream_options = { ...input.stream_options, include_usage: true };
  }
  return body;
}

export const providerRoutes: FastifyPluginAsync<ProviderRouteOptions> = async (app, options) => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKeys = options.apiKeys ?? configuredKeys();
  const upstreamApiKey = options.upstreamApiKey ?? env.OPENROUTER_API_KEY;
  const upstreamBaseUrl = options.upstreamBaseUrl ?? env.OPENROUTER_BASE_URL;
  const listModels = options.listModels ?? (() => prisma.llmModel.findMany({
    where: { enabled: true, provider: "openrouter" },
    orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
    select: { providerModelId: true, displayName: true, contextWindowTokens: true, maxOutputTokens: true, createdAt: true }
  }));
  const findModel = options.findModel ?? ((id: string) => prisma.llmModel.findFirst({
    where: { enabled: true, provider: "openrouter", providerModelId: id },
    select: { providerModelId: true, displayName: true, contextWindowTokens: true, maxOutputTokens: true, createdAt: true }
  }));

  const authenticateToking = async (request: FastifyRequest, reply: FastifyReply) => {
    if (apiKeys.length === 0) return providerError(reply, 503, "provider_not_configured", "Toking provider access is not configured");
    const token = bearerToken(request);
    if (!token || !apiKeys.some((expected) => verifyPlainText(token, expected))) {
      return providerError(reply, 401, "invalid_api_key", "Invalid provider credential");
    }
    if (request.headers["x-toking-provider-contract"] !== env.TOKING_PROVIDER_CONTRACT_VERSION) {
      return providerError(reply, 400, "unsupported_contract_version", "X-Toking-Provider-Contract must be 1");
    }
  };

  app.get("/models", { preHandler: authenticateToking }, async (_request, reply) => {
    const models = await listModels();
    const uniqueModels = [...new Map(models.map((model) => [model.providerModelId, model])).values()];
    reply.header("cache-control", "no-store");
    return {
      object: "list",
      data: uniqueModels.map((model) => ({
        id: model.providerModelId,
        object: "model",
        created: Math.floor(model.createdAt.getTime() / 1000),
        owned_by: model.providerModelId.split("/")[0] ?? "gangram",
        name: model.displayName,
        context_length: model.contextWindowTokens,
        supported_parameters: ["max_tokens", "max_completion_tokens", "stream"]
      }))
    };
  });

  app.post("/chat/completions", { preHandler: authenticateToking }, async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return providerError(reply, 400, "invalid_request", "Request validation failed");
    const input = parsed.data;
    const model = await findModel(input.model);
    if (!model) return providerError(reply, 404, "model_not_found", "Use a model ID returned by GET /v1/models");
    if (!upstreamApiKey) return providerError(reply, 503, "upstream_not_configured", "Gangram inference is not configured");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.AGENT_RUN_TIMEOUT_MS);
    const requestId = request.headers["x-toking-request-id"]?.toString() ?? request.id;
    let upstream: Response;
    try {
      upstream = await fetchImpl(`${upstreamBaseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${upstreamApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.OPENROUTER_SITE_URL,
          "X-Title": env.OPENROUTER_APP_NAME,
          "X-Request-Id": requestId
        },
        body: JSON.stringify(boundedRequest(input, model))
      });
    } catch (error) {
      clearTimeout(timeout);
      const timedOut = error instanceof Error && error.name === "AbortError";
      return providerError(reply, 502, "upstream_unavailable", timedOut ? "Upstream inference timed out" : "Upstream inference is unavailable");
    }

    if (!upstream.ok) {
      clearTimeout(timeout);
      const status = upstream.status === 400 || upstream.status === 404 || upstream.status === 429 ? upstream.status : 502;
      return providerError(reply, status, status === 429 ? "rate_limit_exceeded" : "upstream_error", `Upstream inference failed with status ${upstream.status}`);
    }

    if (!input.stream) {
      clearTimeout(timeout);
      const payload = completionSchema.safeParse(await upstream.json().catch(() => null));
      if (!payload.success) return providerError(reply, 502, "invalid_upstream_response", "Upstream returned an invalid OpenAI response");
      return reply.send(payload.data);
    }

    if (!upstream.body || !upstream.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
      clearTimeout(timeout);
      await upstream.body?.cancel().catch(() => undefined);
      return providerError(reply, 502, "invalid_upstream_response", "Upstream did not return an OpenAI event stream");
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-gangram-request-id": requestId
    });
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const closeHandler = () => controller.abort();
    reply.raw.once("close", closeHandler);
    let pending = "";
    let sawDone = false;
    let sawUsage = false;
    let outputCharacters = 0;
    let lastId = `chatcmpl-${requestId}`;

    const handleEvent = (event: string) => {
      const dataLine = event.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) throw new Error("Missing SSE data field");
      const data = dataLine.slice(5).trim();
      if (data === "[DONE]") {
        sawDone = true;
        return;
      }
      const parsedChunk = chunkSchema.parse(JSON.parse(data));
      lastId = parsedChunk.id;
      sawUsage ||= parsedChunk.usage !== undefined && parsedChunk.usage !== null;
      for (const choice of parsedChunk.choices) {
        const content = choice.delta.content;
        if (typeof content === "string") outputCharacters += content.length;
      }
      reply.raw.write(`data: ${JSON.stringify(parsedChunk)}\n\n`);
    };

    try {
      while (!sawDone) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
        const events = pending.split("\n\n");
        pending = events.pop() ?? "";
        for (const event of events) {
          if (event.trim()) handleEvent(event);
          if (sawDone) break;
        }
      }
      pending += decoder.decode();
      if (!sawDone && pending.trim()) handleEvent(pending.trim());
      if (!sawDone) throw new Error("Stream ended before [DONE]");
      if (!sawUsage) {
        const promptTokens = estimatedTokens(input.messages);
        const completionTokens = Math.max(1, Math.ceil(outputCharacters / 4));
        reply.raw.write(`data: ${JSON.stringify({
          id: lastId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: model.providerModelId,
          choices: [],
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens
          }
        })}\n\n`);
      }
      if (!reply.raw.destroyed) reply.raw.end("data: [DONE]\n\n");
    } catch {
      if (!reply.raw.destroyed) {
        reply.raw.end(`data: ${JSON.stringify(errorPayload("invalid_upstream_response", "Upstream returned an invalid OpenAI stream"))}\n\ndata: [DONE]\n\n`);
      }
    } finally {
      controller.abort();
      clearTimeout(timeout);
      reply.raw.off("close", closeHandler);
      reader.releaseLock();
    }
    return reply;
  });
};
