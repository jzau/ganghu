import type { ApiUser, ConversationDto, ConversationSearchResultDto, ConversationShareDto, LlmModelDto, MessageDto } from "@ai-chat/shared";

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.code ?? error.message ?? "Request failed");
  }
  return response.json() as Promise<T>;
}

export const endpoints = {
  me: () => api<{ user: ApiUser }>("/api/me"),
  updateMe: (input: { displayName: string | null }) => api<{ user: ApiUser }>("/api/me", { method: "PATCH", body: JSON.stringify(input) }),
  models: () => api<{ models: LlmModelDto[] }>("/api/models"),
  conversations: () => api<{ conversations: ConversationDto[] }>("/api/conversations"),
  searchConversations: (query: string) => api<{ results: ConversationSearchResultDto[] }>(`/api/conversations/search?q=${encodeURIComponent(query)}`),
  messages: (conversationId: string) => api<{ messages: MessageDto[] }>(`/api/conversations/${conversationId}/messages`),
  sharedConversation: (token: string) => api<{ share: ConversationShareDto }>(`/api/shared/${token}`)
};
