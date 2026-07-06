import type { Conversation, LlmModel, Message, User } from "@prisma/client";
import type { ApiUser, ConversationDto, LlmModelDto, MessageDto } from "@ai-chat/shared";

type ConversationWithMessageCount = Conversation & {
  _count?: {
    messages: number;
  };
};

export function toUserDto(user: User): ApiUser {
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    displayName: user.displayName,
    externalAuthUserId: user.externalAuthUserId,
    appTokenBalance: user.appTokenBalance,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null
  };
}

export function toModelDto(model: LlmModel): LlmModelDto {
  return {
    id: model.id,
    displayName: model.displayName,
    provider: model.provider,
    providerModelId: model.providerModelId,
    logoUrl: model.logoUrl,
    enabled: model.enabled,
    inputAppTokensPer1k: model.inputAppTokensPer1k,
    outputAppTokensPer1k: model.outputAppTokensPer1k,
    minimumRequiredBalance: model.minimumRequiredBalance,
    maxOutputTokens: model.maxOutputTokens,
    contextWindowTokens: model.contextWindowTokens,
    sortOrder: model.sortOrder
  };
}

export function toConversationDto(conversation: ConversationWithMessageCount): ConversationDto {
  return {
    id: conversation.id,
    title: conversation.title,
    isDraft: conversation._count?.messages === 0,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString()
  };
}

export function toMessageDto(message: Message): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    modelId: message.modelId,
    createdAt: message.createdAt.toISOString()
  };
}
