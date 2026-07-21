import { env } from "../../lib/env.js";

export interface LlmChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  generationId?: string;
  cost?: string;
}

type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number | string;
};

const nonStreamingFirstModels = new Set(["tencent/hy3", "tencent/hy3:free"]);
const modelCapabilityCache = new Map<string, { supportsTools: boolean; expiresAt: number }>();
const modelCapabilityCacheTtlMs = 10 * 60 * 1000;

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerMessage?: string
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export async function getOpenRouterModelEndpointCount(model: string) {
  const headers: Record<string, string> = {};
  if (env.OPENROUTER_API_KEY) headers.Authorization = `Bearer ${env.OPENROUTER_API_KEY}`;

  const response = await fetch(`${env.OPENROUTER_BASE_URL}/models/${encodeModelPath(model)}/endpoints`, { headers });
  if (!response.ok) {
    const providerMessage = await readOpenRouterError(response);
    throw new OpenRouterError(`OpenRouter model lookup failed with status ${response.status}`, response.status, providerMessage);
  }

  const payload = (await response.json()) as { data?: { endpoints?: unknown[] } };
  return Array.isArray(payload.data?.endpoints) ? payload.data.endpoints.length : 0;
}

export async function getOpenRouterModelSupportsTools(model: string) {
  const cached = modelCapabilityCache.get(model);
  if (cached && cached.expiresAt > Date.now()) return cached.supportsTools;

  const headers: Record<string, string> = {};
  if (env.OPENROUTER_API_KEY) headers.Authorization = `Bearer ${env.OPENROUTER_API_KEY}`;

  const response = await fetch(`${env.OPENROUTER_BASE_URL}/model/${encodeModelPath(model)}`, { headers });
  if (!response.ok) {
    const providerMessage = await readOpenRouterError(response);
    throw new OpenRouterError(`OpenRouter model lookup failed with status ${response.status}`, response.status, providerMessage);
  }

  const payload = (await response.json()) as { data?: { supported_parameters?: unknown[] } };
  const supportsTools = Array.isArray(payload.data?.supported_parameters) && payload.data.supported_parameters.includes("tools");
  modelCapabilityCache.set(model, { supportsTools, expiresAt: Date.now() + modelCapabilityCacheTtlMs });
  return supportsTools;
}

export async function* streamOpenRouterChat(input: {
  model: string;
  messages: LlmChatMessage[];
  maxTokens: number;
  webSearch?: boolean;
  signal?: AbortSignal;
}): AsyncGenerator<{ delta: string }, StreamResult> {
  if (!env.OPENROUTER_API_KEY) {
    const fallback = "OpenRouter is not configured yet. Add OPENROUTER_API_KEY to enable live model responses.";
    yield { delta: fallback };
    return {
      content: fallback,
      usage: {
        promptTokens: estimateTokens(input.messages.map((message) => message.content).join(" ")),
        completionTokens: estimateTokens(fallback),
        totalTokens: estimateTokens(input.messages.map((message) => message.content).join(" ")) + estimateTokens(fallback)
      }
    };
  }

  if (shouldUseNonStreamingFirst(input.model)) {
    const fallback = await completeOpenRouterChat(input);
    yield { delta: fallback.content };
    return fallback;
  }

  const response = await requestOpenRouterChat(input, true);

  if (!response.ok || !response.body) {
    const providerMessage = await readOpenRouterError(response);
    throw new OpenRouterError(`OpenRouter request failed with status ${response.status}`, response.status, providerMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let generationId: string | undefined;
  let cost: string | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (payload === "[DONE]") continue;
      const parsed = JSON.parse(payload);
      generationId = parsed.id ?? generationId;
      const delta = parsed.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        content += delta;
        yield { delta };
      }
      if (parsed.usage) {
        usage = toUsage(parsed.usage, usage);
        cost = parsed.usage.cost === undefined ? cost : String(parsed.usage.cost);
      }
    }
  }

  if (!content.trim() && usage.totalTokens === 0) {
    const fallback = await completeOpenRouterChat(input);
    yield { delta: fallback.content };
    return fallback;
  }

  if (!content.trim()) {
    throw new OpenRouterError("OpenRouter provider returned an empty response", 502);
  }

  if (usage.totalTokens === 0) {
    usage = {
      promptTokens: estimateTokens(input.messages.map((message) => message.content).join(" ")),
      completionTokens: estimateTokens(content),
      totalTokens: estimateTokens(input.messages.map((message) => message.content).join(" ")) + estimateTokens(content)
    };
  }

  return { content, usage, generationId, cost };
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function encodeModelPath(model: string) {
  return model.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function shouldUseNonStreamingFirst(model: string) {
  return nonStreamingFirstModels.has(model);
}

async function completeOpenRouterChat(input: { model: string; messages: LlmChatMessage[]; maxTokens: number; webSearch?: boolean; signal?: AbortSignal }): Promise<StreamResult> {
  const response = await requestOpenRouterChat(input, false);
  if (!response.ok) {
    const providerMessage = await readOpenRouterError(response);
    throw new OpenRouterError(`OpenRouter request failed with status ${response.status}`, response.status, providerMessage);
  }

  const parsed = await response.json() as {
    id?: string;
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: OpenRouterUsage;
  };
  const content = typeof parsed.choices?.[0]?.message?.content === "string" ? parsed.choices[0].message.content : "";
  if (!content.trim()) {
    throw new OpenRouterError("OpenRouter provider returned an empty response", 502);
  }

  return {
    content,
    usage: toUsage(parsed.usage),
    generationId: parsed.id,
    cost: parsed.usage?.cost === undefined ? undefined : String(parsed.usage.cost)
  };
}

function requestOpenRouterChat(input: { model: string; messages: LlmChatMessage[]; maxTokens: number; webSearch?: boolean; signal?: AbortSignal }, stream: boolean) {
  return fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    signal: input.signal,
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.OPENROUTER_SITE_URL,
      "X-Title": env.OPENROUTER_APP_NAME
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      max_tokens: input.maxTokens,
      stream,
      usage: { include: true },
      ...(input.webSearch ? { tools: [{ type: "openrouter:web_search" }] } : {})
    })
  });
}

function toUsage(rawUsage?: OpenRouterUsage, fallback = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }) {
  return {
    promptTokens: rawUsage?.prompt_tokens ?? fallback.promptTokens,
    completionTokens: rawUsage?.completion_tokens ?? fallback.completionTokens,
    totalTokens: rawUsage?.total_tokens ?? fallback.totalTokens
  };
}

async function readOpenRouterError(response: Response) {
  const body = await response.text().catch(() => "");
  if (!body) return undefined;

  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown };
    const message = parsed.error?.message ?? parsed.message;
    return typeof message === "string" && message.trim() ? message.trim() : body.slice(0, 500);
  } catch {
    return body.slice(0, 500);
  }
}
