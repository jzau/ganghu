export type UserStatus = "active" | "disabled";
export type MessageRole = "system" | "user" | "assistant";
export type LedgerType = "redeem" | "chat_usage" | "admin_adjustment" | "refund";

export interface ApiUser {
  id: string;
  phoneNumber: string;
  displayName: string | null;
  externalAuthUserId: string | null;
  appTokenBalance: number;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface LlmModelDto {
  id: string;
  displayName: string;
  displayNameZh: string | null;
  modelSeriesName: string | null;
  modelSeriesNameZh: string | null;
  provider: string;
  providerModelId: string;
  logoUrl: string | null;
  enabled: boolean;
  inputAppTokensPer1k: number;
  outputAppTokensPer1k: number;
  minimumRequiredBalance: number;
  maxOutputTokens: number;
  contextWindowTokens: number;
  sortOrder: number;
  supportsWebSearch: boolean;
}

export interface ConversationDto {
  id: string;
  title: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  modelId: string | null;
  createdAt: string;
}

export interface ConversationShareDto {
  token: string;
  conversation: ConversationDto;
  messages: MessageDto[];
  createdAt: string;
}

export interface ChatUsageDto {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalAppTokensCharged: number;
  updatedBalance: number;
}

export type SearchMode = "off" | "explicit" | "auto";

export interface SourceDto {
  sourceId: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  provider: string;
  rank: number;
}

export type StreamEvent =
  | { type: "run_started"; runId: string; searchMode: SearchMode }
  | { type: "search_started"; queryId: string; query: string }
  | { type: "search_results"; queryId: string; sources: SourceDto[] }
  | { type: "delta"; content: string }
  | { type: "done"; message: MessageDto; sources?: SourceDto[]; usage: ChatUsageDto }
  | { type: "error"; code: string; message: string; retryable?: boolean };
