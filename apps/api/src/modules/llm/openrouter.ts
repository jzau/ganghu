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

export async function* streamOpenRouterChat(input: {
  model: string;
  messages: LlmChatMessage[];
  maxTokens: number;
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

  const response = await fetch(`${env.OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
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
      stream: true,
      usage: { include: true }
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(`OpenRouter request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let generationId: string | undefined;

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
        usage = {
          promptTokens: parsed.usage.prompt_tokens ?? usage.promptTokens,
          completionTokens: parsed.usage.completion_tokens ?? usage.completionTokens,
          totalTokens: parsed.usage.total_tokens ?? usage.totalTokens
        };
      }
    }
  }

  if (usage.totalTokens === 0) {
    usage = {
      promptTokens: estimateTokens(input.messages.map((message) => message.content).join(" ")),
      completionTokens: estimateTokens(content),
      totalTokens: estimateTokens(input.messages.map((message) => message.content).join(" ")) + estimateTokens(content)
    };
  }

  return { content, usage, generationId };
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}
