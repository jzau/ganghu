export type UserStatus = "active" | "disabled";
export type MessageRole = "system" | "user" | "assistant";
export type LedgerType = "redeem" | "chat_usage" | "admin_adjustment" | "refund";

export interface ApiUser {
  id: string;
  phoneNumber: string;
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
  provider: string;
  providerModelId: string;
  enabled: boolean;
  inputAppTokensPer1k: number;
  outputAppTokensPer1k: number;
  minimumRequiredBalance: number;
  maxOutputTokens: number;
  contextWindowTokens: number;
  sortOrder: number;
}

export interface ConversationDto {
  id: string;
  title: string;
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

export interface ChatUsageDto {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalAppTokensCharged: number;
  updatedBalance: number;
}

export type StreamEvent =
  | { type: "delta"; content: string }
  | { type: "done"; message: MessageDto; usage: ChatUsageDto }
  | { type: "error"; code: string; message: string };
