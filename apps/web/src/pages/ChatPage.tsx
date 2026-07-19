import type { ApiUser, LlmModelDto, MessageDto } from "@ai-chat/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Languages, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, Send, Sparkles, Square, Ticket, Trash2, Upload, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useNavigate, useParams } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { BrandLockup } from "../components/BrandLockup";
import { Button } from "../components/Button";
import { LoginForm } from "../components/LoginForm";
import { Modal } from "../components/Modal";
import { api, endpoints } from "../lib/api";
import { commonText, languageLabels, localizeErrorMessage, useLanguage, type Language } from "../lib/i18n";

const chatText = {
  en: {
    loading: "Loading",
    closeConversations: "Close conversations",
    home: "Go to homepage",
    newChat: "New chat",
    history: "History",
    collapseSidebar: "Collapse sidebar",
    openAccountMenu: "Open account menu",
    openConversations: "Open conversations",
    reopenSidebar: "Open sidebar",
    selectModel: "Select model",
    modelsLoading: "Models loading",
    models: "Models",
    startConversation: "Start a conversation",
    emptyHint: "Choose a model and send a message.",
    thinking: "Assistant is thinking",
    messagePlaceholder: "Message",
    sendMessage: "Send message",
    stopResponse: "Stop response",
    redeemCode: "Redeem code",
    code: "Code",
    addedTokens: (amount: number) => `Added ${amount} app tokens`,
    chatFailed: "Chat failed",
    shareConversation: "Share conversation",
    shareCopied: "Share link copied successfully",
    shareFailed: "Could not create share link",
    streamInterrupted: "Response was interrupted. Refreshing conversation.",
    modelLocked: "Model is locked for this conversation",
    signInRequired: "Sign in to continue",
    guestAccount: "Sign in",
    deleteConversationTitle: "Delete conversation?",
    deleteConversationBody: "This conversation will be permanently deleted.",
    cancel: "Cancel",
    delete: "Delete"
  },
  zh: {
    loading: "加载中",
    closeConversations: "关闭会话列表",
    home: "返回首页",
    newChat: "新建对话",
    history: "历史记录",
    collapseSidebar: "收起侧边栏",
    openAccountMenu: "打开账户菜单",
    openConversations: "打开会话列表",
    reopenSidebar: "展开侧边栏",
    selectModel: "选择模型",
    modelsLoading: "模型加载中",
    models: "模型",
    startConversation: "开始对话",
    emptyHint: "选择模型并发送消息。",
    thinking: "助手正在思考",
    messagePlaceholder: "输入消息",
    sendMessage: "发送消息",
    stopResponse: "停止回复",
    redeemCode: "兑换码",
    code: "兑换码",
    addedTokens: (amount: number) => `已添加 ${amount} 个词元`,
    chatFailed: "聊天失败",
    shareConversation: "分享对话",
    shareCopied: "分享链接复制成功",
    shareFailed: "无法创建分享链接",
    streamInterrupted: "回复已中断，正在刷新对话。",
    modelLocked: "此对话已锁定模型",
    signInRequired: "请先登录",
    guestAccount: "登录",
    deleteConversationTitle: "删除对话？",
    deleteConversationBody: "此对话将被永久删除。",
    cancel: "取消",
    delete: "删除"
  }
} as const;

const defaultConversationTitles = new Set<string>([chatText.en.newChat, chatText.zh.newChat]);

function conversationTitleForLanguage(title: string, language: Language) {
  return defaultConversationTitles.has(title) ? chatText[language].newChat : title;
}

function clearTextSelection() {
  window.getSelection()?.removeAllRanges();
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function clearTextSelectionAfterRender() {
  clearTextSelection();
  window.requestAnimationFrame(clearTextSelection);
  window.setTimeout(clearTextSelection, 50);
  window.setTimeout(clearTextSelection, 160);
}

type ModelLogoData = Pick<LlmModelDto, "displayName" | "provider" | "providerModelId" | "logoUrl">;
type RenderMessage = MessageDto & { renderKey?: string };
const modelLogoSize = {
  md: 34,
  sm: 32
} as const;

function getModelLogoVariant(model?: ModelLogoData) {
  const modelKey = `${model?.provider ?? ""} ${model?.providerModelId ?? ""} ${model?.displayName ?? ""}`.toLowerCase();
  if (modelKey.includes("deepseek")) return "deepseek";
  if (modelKey.includes("kimi") || modelKey.includes("moonshot")) return "kimi";
  return "default";
}

function getModelSubtitle(model: LlmModelDto | undefined, language: Language) {
  if (!model) return undefined;
  if (language === "zh") return model.modelSeriesNameZh?.trim() || model.modelSeriesName?.trim() || model.providerModelId;
  return model.modelSeriesName?.trim() || model.providerModelId;
}

function getModelDisplayName(model: LlmModelDto | undefined, language: Language) {
  if (!model) return undefined;
  return language === "zh" ? model.displayNameZh?.trim() || model.displayName : model.displayName;
}

function getModelGroupKey(model: LlmModelDto) {
  return `${model.provider}:${model.displayName.trim().toLowerCase()}`;
}

function ModelLogo({ model, size = "md" }: { model?: ModelLogoData; size?: "sm" | "md" }) {
  const boxSize = modelLogoSize[size];
  const boxStyle = {
    width: boxSize,
    height: boxSize,
    minWidth: boxSize,
    maxWidth: boxSize,
    flexBasis: boxSize
  };

  if (model?.logoUrl) {
    return (
      <span className={`nm-model-logo nm-model-logo-${size} is-image`} style={boxStyle} aria-hidden="true">
        <span className="nm-model-logo-frame">
          <img src={model.logoUrl} alt="" />
        </span>
      </span>
    );
  }

  const variant = getModelLogoVariant(model);

  if (variant === "deepseek") {
    return (
      <span className={`nm-model-logo nm-model-logo-${size} is-deepseek`} style={boxStyle} aria-hidden="true">
        <span className="nm-model-logo-mark">D</span>
      </span>
    );
  }

  if (variant === "kimi") {
    return (
      <span className={`nm-model-logo nm-model-logo-${size} is-kimi`} style={boxStyle} aria-hidden="true">
        <span className="nm-model-logo-mark">K</span>
      </span>
    );
  }

  return (
    <span className={`nm-model-logo nm-model-logo-${size} is-default`} style={boxStyle} aria-hidden="true">
      <Sparkles size={size === "md" ? 17 : 15} />
    </span>
  );
}

export function ChatPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { conversationId: routeConversationId = "" } = useParams();
  const { language, setLanguage } = useLanguage();
  const t = chatText[language];
  const common = commonText[language];
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const composingMessageRef = useRef(false);
  const sendInFlightRef = useRef(false);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const longPressedConversationIdRef = useRef<string | null>(null);
  const streamingAssistantKeyRef = useRef("");
  const assistantRenderKeysRef = useRef<Record<string, string>>({});
  const scrollHideTimeouts = useRef<Record<string, number>>({});
  const [activeConversationId, setActiveConversationId] = useState<string>(routeConversationId);
  const [draft, setDraft] = useState("");
  const [modelId, setModelId] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState<MessageDto | null>(null);
  const [completedAssistantMessage, setCompletedAssistantMessage] = useState<MessageDto | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [toastKind, setToastKind] = useState<"error" | "success">("error");
  const [isSending, setIsSending] = useState(false);
  const [accountMenuView, setAccountMenuView] = useState<"main" | "redeem">("main");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [openModelGroupKey, setOpenModelGroupKey] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [scrollingAreas, setScrollingAreas] = useState<Record<string, boolean>>({});
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [revealedDeleteConversationId, setRevealedDeleteConversationId] = useState<string | null>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: endpoints.me, retry: false });
  const models = useQuery({ queryKey: ["models"], queryFn: endpoints.models });
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: endpoints.conversations, enabled: me.isSuccess });
  const messages = useQuery({
    queryKey: ["messages", activeConversationId],
    queryFn: () => endpoints.messages(activeConversationId),
    enabled: Boolean(activeConversationId && me.isSuccess)
  });

  useEffect(() => {
    const availableModels = models.data?.models;
    if (!availableModels?.length) return;
    if (!availableModels.some((model) => model.id === modelId)) setModelId(availableModels[0].id);
  }, [modelId, models.data]);

  useEffect(() => {
    setActiveConversationId(routeConversationId);
  }, [routeConversationId]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeoutId = window.setTimeout(() => setToastMessage(""), 4200);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  useEffect(() => {
    return () => {
      streamAbortControllerRef.current?.abort();
      Object.values(scrollHideTimeouts.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  useEffect(() => {
    if (revealedDeleteConversationId) clearTextSelectionAfterRender();
  }, [revealedDeleteConversationId]);

  useEffect(() => {
    document.documentElement.classList.add("nm-chat-document");
    document.body.classList.add("nm-chat-body");
    return () => {
      document.documentElement.classList.remove("nm-chat-document");
      document.body.classList.remove("nm-chat-body");
    };
  }, []);

  const allMessages = useMemo<RenderMessage[]>(() => {
    const base = (messages.data?.messages ?? []).map((message) => ({
      ...message,
      renderKey: assistantRenderKeysRef.current[message.id]
    }));
    const pending =
      pendingUserMessage &&
      (!pendingUserMessage.conversationId || pendingUserMessage.conversationId === activeConversationId) &&
      !base.some(
        (message) =>
          message.role === "user" &&
          message.content === pendingUserMessage.content &&
          new Date(message.createdAt).getTime() >= new Date(pendingUserMessage.createdAt).getTime()
      )
        ? [pendingUserMessage]
        : [];
    const completed =
      completedAssistantMessage &&
      completedAssistantMessage.conversationId === activeConversationId &&
      !base.some((message) => message.id === completedAssistantMessage.id)
        ? [completedAssistantMessage]
        : [];
    if (streamingText) {
      return [
        ...base,
        ...pending,
        {
          id: "streaming",
          renderKey: streamingAssistantKeyRef.current || "streaming",
          conversationId: activeConversationId,
          role: "assistant",
          content: streamingText,
          modelId,
          createdAt: new Date().toISOString()
        }
      ];
    }
    return [...base, ...pending, ...completed];
  }, [activeConversationId, completedAssistantMessage, messages.data, modelId, pendingUserMessage, streamingText]);

  const persistedMessages = messages.data?.messages ?? [];
  const conversationModelId = persistedMessages.find((message) => message.role === "assistant" && message.modelId)?.modelId ?? null;
  const hasPendingMessage =
    pendingUserMessage &&
    (!pendingUserMessage.conversationId || pendingUserMessage.conversationId === activeConversationId);
  const conversationIsLoading = Boolean(activeConversationId && messages.isLoading);
  const modelSelectionLocked = conversationIsLoading || Boolean(hasPendingMessage) || Boolean(streamingText) || Boolean(conversationModelId);
  const selectedModel = models.data?.models.find((model) => model.id === modelId) ?? models.data?.models[0];
  const modelGroups = useMemo(() => {
    const groups = new Map<string, LlmModelDto[]>();
    for (const model of models.data?.models ?? []) {
      const key = getModelGroupKey(model);
      groups.set(key, [...(groups.get(key) ?? []), model]);
    }
    return Array.from(groups, ([key, groupModels]) => ({ key, models: groupModels }));
  }, [models.data?.models]);
  const balance = me.data?.user.appTokenBalance ?? 0;
  const phoneNumber = me.data?.user.phoneNumber ?? "";
  const isAuthenticated = me.isSuccess;
  const visibleConversations = isAuthenticated
    ? (conversations.data?.conversations ?? []).filter((conversation) => !conversation.isDraft)
    : [];
  const activeConversation = visibleConversations.find((conversation) => conversation.id === activeConversationId);
  const activeConversationTitle = activeConversation ? conversationTitleForLanguage(activeConversation.title, language) : t.startConversation;

  useEffect(() => {
    if (conversationModelId && modelId !== conversationModelId) setModelId(conversationModelId);
  }, [conversationModelId, modelId]);

  useEffect(() => {
    if (modelSelectionLocked) {
      setModelMenuOpen(false);
      setOpenModelGroupKey(null);
    }
  }, [modelSelectionLocked]);

  useEffect(() => {
    if (!modelMenuOpen) setOpenModelGroupKey(null);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!accountMenuOpen && !modelMenuOpen && !revealedDeleteConversationId) return;

    function closeMenusOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (accountMenuRef.current?.contains(target) || modelMenuRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".nm-history-item")) return;
      setAccountMenuOpen(false);
      setAccountMenuView("main");
      setModelMenuOpen(false);
      setOpenModelGroupKey(null);
      setRevealedDeleteConversationId(null);
    }

    document.addEventListener("pointerdown", closeMenusOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeMenusOnOutsidePointer);
  }, [accountMenuOpen, modelMenuOpen, revealedDeleteConversationId]);

  useEffect(() => {
    if (!activeConversationId) return;
    const frameId = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeConversationId, allMessages.length, streamingText]);

  function requireAuth() {
    if (isAuthenticated) return true;
    setAccountMenuOpen(false);
    setAccountMenuView("main");
    setLoginDialogOpen(true);
    return false;
  }

  async function sendMessage() {
    if (!draft.trim() || !modelId || isSending || sendInFlightRef.current || conversationIsLoading) return;
    if (!requireAuth()) return;
    const message = draft;
    const optimisticMessage: MessageDto = {
      id: `pending-${Date.now()}`,
      conversationId: activeConversationId,
      role: "user",
      content: message,
      modelId,
      createdAt: new Date().toISOString()
    };
    setDraft("");
    streamingAssistantKeyRef.current = `assistant-${optimisticMessage.id}`;
    setPendingUserMessage(optimisticMessage);
    setCompletedAssistantMessage(null);
    setStreamingText("");
    setToastMessage("");
    sendInFlightRef.current = true;
    stopRequestedRef.current = false;
    const abortController = new AbortController();
    streamAbortControllerRef.current = abortController;
    setIsSending(true);
    let acceptedConversationId = activeConversationId;
    let serverAcceptedMessage = false;
    let serverSentErrorEvent = false;
    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        signal: abortController.signal,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeConversationId || undefined, modelId, message })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: t.chatFailed }));
        throw new Error(error.message ?? t.chatFailed);
      }
      if (!response.body) throw new Error(t.chatFailed);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const event = chunk.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
          const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
          if (!event || !dataLine) continue;
          const data = JSON.parse(dataLine.slice(5));
          if (event === "accepted") {
            serverAcceptedMessage = true;
            acceptedConversationId = data.message.conversationId;
            setPendingUserMessage({ ...data.message, renderKey: optimisticMessage.id });
            if (!activeConversationId) {
              setActiveConversationId(data.message.conversationId);
              navigate(`/c/${data.message.conversationId}`);
            }
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
          }
          if (event === "delta") setStreamingText((current) => current + data.content);
          if (event === "error") {
            serverSentErrorEvent = true;
            throw new Error(data.message ?? t.chatFailed);
          }
          if (event === "done") {
            const assistantRenderKey = streamingAssistantKeyRef.current || `assistant-${data.message.id}`;
            assistantRenderKeysRef.current[data.message.id] = assistantRenderKey;
            setCompletedAssistantMessage({ ...data.message, renderKey: assistantRenderKey });
            setStreamingText("");
            setIsSending(false);
            queryClient.invalidateQueries({ queryKey: ["me"] });
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
            setPendingUserMessage((pending) => pending ? { ...pending, conversationId: data.message.conversationId } : pending);
            if (!activeConversationId) setActiveConversationId(data.message.conversationId);
            queryClient.invalidateQueries({ queryKey: ["messages", data.message.conversationId] });
          }
        }
      }
    } catch (error) {
      if (stopRequestedRef.current && abortController.signal.aborted) return;
      setPendingUserMessage(null);
      setStreamingText("");
      if (serverAcceptedMessage && !serverSentErrorEvent) {
        queryClient.invalidateQueries({ queryKey: ["conversations"] });
        if (acceptedConversationId) queryClient.invalidateQueries({ queryKey: ["messages", acceptedConversationId] });
      } else {
        setDraft(message);
      }
      setToastKind("error");
      setToastMessage(serverAcceptedMessage && !serverSentErrorEvent ? t.streamInterrupted : localizeErrorMessage(error, language, t.chatFailed));
    } finally {
      if (streamAbortControllerRef.current === abortController) streamAbortControllerRef.current = null;
      sendInFlightRef.current = false;
      setIsSending(false);
    }
  }

  function stopResponse() {
    if (!isSending) return;
    stopRequestedRef.current = true;
    streamAbortControllerRef.current?.abort();
  }

  function markScrolling(area: string) {
    window.clearTimeout(scrollHideTimeouts.current[area]);
    setScrollingAreas((current) => (current[area] ? current : { ...current, [area]: true }));
    scrollHideTimeouts.current[area] = window.setTimeout(() => {
      setScrollingAreas((current) => ({ ...current, [area]: false }));
    }, 850);
  }

  function startNewChat() {
    if (!requireAuth()) return;
    setSidebarOpen(false);
    if (!activeConversationId) return;

    setActiveConversationId("");
    setDraft("");
    setModelId(models.data?.models[0]?.id ?? "");
    setPendingUserMessage(null);
    setCompletedAssistantMessage(null);
    setStreamingText("");
    setModelMenuOpen(false);
    setOpenModelGroupKey(null);
    setRevealedDeleteConversationId(null);
    navigate("/");
  }

  const deleteConversation = useMutation({
    mutationFn: (id: string) => api(`/api/conversations/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      if (activeConversationId === id) {
        setActiveConversationId("");
        navigate("/");
      }
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  });

  function clearConversationLongPress() {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function revealConversationDelete(conversationId: string) {
    clearTextSelectionAfterRender();
    setRevealedDeleteConversationId(conversationId);
  }

  function startConversationLongPress(conversationId: string, pointerType: string) {
    if (pointerType === "mouse") return;
    clearConversationLongPress();
    longPressedConversationIdRef.current = null;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressedConversationIdRef.current = conversationId;
      revealConversationDelete(conversationId);
    }, 650);
  }

  const shareConversation = useMutation({
    mutationFn: (id: string) => api<{ token: string }>(`/api/conversations/${id}/share`, { method: "POST" }),
    onSuccess: async (data) => {
      const url = `${window.location.origin}/share/${data.token}`;
      await window.navigator.clipboard?.writeText(url).catch(() => undefined);
      setToastKind("success");
      setToastMessage(t.shareCopied);
    },
    onError: (error) => {
      setToastKind("error");
      setToastMessage(localizeErrorMessage(error, language, t.shareFailed));
    }
  });
  const shareDisabled = !activeConversationId || persistedMessages.length === 0 || shareConversation.isPending;

  return (
    <main className="nm-page nm-chat-page">
      <div className="nm-shell">
        <div className={`nm-layout ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
          {sidebarOpen && <button className="nm-drawer-scrim md:hidden" aria-label={t.closeConversations} onClick={() => setSidebarOpen(false)} />}
          <aside className={`nm-sidebar ${sidebarOpen ? "is-open" : ""}`}>
            <div className="nm-sidebar-top">
              <a className="nm-brand nm-sidebar-brand nm-brand-home" href="/" aria-label={t.home} title={t.home}>
                <BrandLockup language={language} />
              </a>
              <button
                className="nm-icon-button nm-sidebar-toggle hidden md:grid"
                onClick={() => {
                  setSidebarCollapsed((collapsed) => !collapsed);
                  setAccountMenuOpen(false);
                  setAccountMenuView("main");
                }}
                aria-label={sidebarCollapsed ? t.reopenSidebar : t.collapseSidebar}
                title={sidebarCollapsed ? t.reopenSidebar : t.collapseSidebar}
              >
                {sidebarCollapsed && <span className="nm-sidebar-toggle-logo" aria-hidden="true">⏳</span>}
                <span className="nm-sidebar-toggle-icon" aria-hidden="true">
                  {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
                </span>
              </button>
            </div>

            <button className="nm-action" onClick={startNewChat} disabled={isSending} title={t.newChat}>
              <Plus size={16} />
              <span className="nm-action-label">{t.newChat}</span>
            </button>

            <div className="nm-section-label">{t.history}</div>
            <div className={`nm-history ${scrollingAreas.history ? "is-scrolling" : ""}`} onScroll={() => markScrolling("history")}>
              {visibleConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`nm-history-item ${activeConversationId === conversation.id ? "is-active" : ""} ${revealedDeleteConversationId === conversation.id ? "is-delete-revealed" : ""}`}
                  onClick={() => {
                    if (longPressedConversationIdRef.current === conversation.id) {
                      longPressedConversationIdRef.current = null;
                      return;
                    }
                    setRevealedDeleteConversationId(null);
                    setActiveConversationId(conversation.id);
                    setSidebarOpen(false);
                    navigate(`/c/${conversation.id}`);
                  }}
                  onContextMenu={(event) => event.preventDefault()}
                  onPointerCancel={clearConversationLongPress}
                  onPointerDown={(event) => startConversationLongPress(conversation.id, event.pointerType)}
                  onPointerLeave={clearConversationLongPress}
                  onPointerUp={clearConversationLongPress}
                >
                  <span className="truncate">{conversationTitleForLanguage(conversation.title, language)}</span>
                  <Trash2
                    size={15}
                    className="nm-history-delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteConversation.mutate(conversation.id);
                      setRevealedDeleteConversationId(null);
                    }}
                  />
                </button>
              ))}
            </div>

            <div className="nm-account-anchor relative" ref={accountMenuRef}>
              <button
                className={`nm-account ${accountMenuOpen ? "is-open" : ""}`}
                aria-label={t.openAccountMenu}
                onClick={() => {
                  if (!requireAuth()) return;
                  if (accountMenuOpen) setAccountMenuView("main");
                  setAccountMenuOpen((open) => !open);
                }}
              >
                <div className="nm-avatar-sm" aria-hidden="true">
                  <UserRound size={18} />
                </div>
                <div className="nm-account-label min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-bold">{isAuthenticated ? `${balance.toLocaleString()} ${common.tokens}` : t.guestAccount}</div>
                </div>
                <Menu size={15} className="nm-account-menu-icon shrink-0 opacity-50" />
              </button>
              {accountMenuOpen && (
                <div className={`nm-account-menu ${scrollingAreas.accountMenu ? "is-scrolling" : ""}`} onScroll={() => markScrolling("accountMenu")}>
                  {accountMenuView === "redeem" ? (
                    <RedeemCodeMenu language={language} />
                  ) : (
                    <AccountMenuActions
                      language={language}
                      phoneNumber={phoneNumber}
                      onRedeem={() => setAccountMenuView("redeem")}
                      onLanguageChange={() => {
                        setLanguage(language === "en" ? "zh" : "en");
                        setAccountMenuOpen(false);
                        setAccountMenuView("main");
                      }}
                      onLogout={async () => {
                        await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
                        setActiveConversationId("");
                        setPendingUserMessage(null);
                        setCompletedAssistantMessage(null);
                        setStreamingText("");
                        navigate("/");
                        setAccountMenuOpen(false);
                        setAccountMenuView("main");
                        queryClient.removeQueries({ queryKey: ["conversations"] });
                        queryClient.removeQueries({ queryKey: ["messages"] });
                        queryClient.resetQueries({ queryKey: ["me"] });
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          </aside>

          <section className="nm-chat">
            <header className="nm-chat-header">
              <button className="nm-icon-button md:hidden" onClick={() => setSidebarOpen(true)} aria-label={t.openConversations}>
                <span className="nm-mobile-menu-logo" aria-hidden="true">⏳</span>
              </button>

              <div className="relative min-w-0" ref={modelMenuRef}>
                <button
                  className={`nm-model-button ${modelMenuOpen ? "is-open" : ""}`}
                  onClick={() => {
                    if (!modelSelectionLocked) setModelMenuOpen((open) => !open);
                  }}
                  disabled={modelSelectionLocked}
                  title={modelSelectionLocked ? undefined : t.selectModel}
                >
                  <ModelLogo model={selectedModel} />
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm font-bold">{getModelDisplayName(selectedModel, language) ?? t.selectModel}</span>
                    <span className="block truncate text-[11px] text-[#808080]">
                      {getModelSubtitle(selectedModel, language) ?? t.modelsLoading}
                    </span>
                  </span>
                  {!modelSelectionLocked && <ChevronDown size={15} className="shrink-0 opacity-50" />}
                </button>
                {modelMenuOpen && !modelSelectionLocked && (
                  <div
                    className={`nm-model-menu ${scrollingAreas.modelMenu ? "is-scrolling" : ""}`}
                    role="menu"
                    aria-label={t.models}
                    onScroll={() => markScrolling("modelMenu")}
                  >
                    <div className="nm-section-label px-2">{t.models}</div>
                    {modelGroups.map((group) => {
                      const groupIsActive = group.models.some((model) => model.id === modelId);
                      const activeGroupModel = group.models.find((model) => model.id === modelId);

                      if (group.models.length === 1) {
                        const model = group.models[0];
                        return (
                          <button
                            key={model.id}
                            className={`nm-model-option ${model.id === modelId ? "is-active" : ""}`}
                            role="menuitemradio"
                            aria-checked={model.id === modelId}
                            onClick={() => {
                              setModelId(model.id);
                              setModelMenuOpen(false);
                            }}
                          >
                            <ModelLogo model={model} size="sm" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-bold">{getModelDisplayName(model, language)}</span>
                              <span className="block truncate text-[11px] text-[#808080]">{getModelSubtitle(model, language)}</span>
                            </span>
                            {model.id === modelId && <Check size={16} />}
                          </button>
                        );
                      }

                      const groupIsOpen = openModelGroupKey === group.key;
                      const representativeModel = activeGroupModel ?? group.models[0];
                      return (
                        <div
                          key={group.key}
                          className={`nm-model-group ${groupIsOpen ? "is-open" : ""}`}
                          onPointerEnter={(event) => {
                            if (event.pointerType === "mouse") setOpenModelGroupKey(group.key);
                          }}
                          onPointerLeave={(event) => {
                            if (event.pointerType === "mouse") setOpenModelGroupKey(null);
                          }}
                        >
                          <button
                            className={`nm-model-option nm-model-group-trigger ${groupIsActive ? "is-active" : ""}`}
                            role="menuitem"
                            aria-haspopup="menu"
                            aria-expanded={groupIsOpen}
                            onFocus={() => setOpenModelGroupKey(group.key)}
                            onClick={() => {
                              setModelId(group.models[0].id);
                              setOpenModelGroupKey(group.key);
                            }}
                          >
                            <ModelLogo model={representativeModel} size="sm" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-bold">{getModelDisplayName(group.models[0], language)}</span>
                              <span className="block truncate text-[11px] text-[#808080]">
                                {getModelSubtitle(representativeModel, language)}
                              </span>
                            </span>
                            <ChevronRight size={17} className="nm-model-group-chevron" />
                          </button>

                          {groupIsOpen && (
                            <div className="nm-model-submenu" role="menu" aria-label={getModelDisplayName(group.models[0], language)}>
                              {group.models.map((model) => {
                                const subtitle = getModelSubtitle(model, language);
                                const isActiveModel = model.id === modelId;
                                return (
                                  <button
                                    key={model.id}
                                    className={`nm-model-submenu-option ${isActiveModel ? "is-active" : ""}`}
                                    role="menuitemradio"
                                    aria-checked={isActiveModel}
                                    onClick={() => {
                                      setModelId(model.id);
                                      setOpenModelGroupKey(null);
                                      setModelMenuOpen(false);
                                    }}
                                  >
                                    <span className="min-w-0 flex-1 truncate font-bold">{subtitle}</span>
                                    {isActiveModel && <Check size={16} />}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                className="nm-icon-button nm-share-button ml-auto"
                onClick={() => {
                  if (!shareDisabled) shareConversation.mutate(activeConversationId);
                }}
                aria-label={t.shareConversation}
                title={t.shareConversation}
                disabled={shareDisabled}
              >
                {shareConversation.isPending ? <span className="nm-button-spinner" aria-hidden="true" /> : <Upload size={18} />}
              </button>
            </header>

            <div className={`nm-messages ${scrollingAreas.messages ? "is-scrolling" : ""}`} onScroll={() => markScrolling("messages")}>
              <div className="nm-message-column">
                {allMessages.length === 0 && (
                  <div className="nm-empty">
                    <div className="nm-empty-icon nm-logo-mark" aria-hidden="true">⏳</div>
                    <div className="font-bold">{activeConversationTitle}</div>
                    <div className="mt-1 text-sm text-[#808080]">{t.emptyHint}</div>
                  </div>
                )}
                {allMessages.map((message) => (
                  <div key={message.renderKey ?? message.id} className={`nm-message ${message.role === "user" ? "is-user" : "is-assistant"}`}>
                    <div className="nm-bubble">
                      <MessageContent message={message} />
                    </div>
                  </div>
                ))}
                {isSending && !streamingText && !completedAssistantMessage && (
                  <div className="nm-message is-assistant is-loading" aria-live="polite" aria-label={t.thinking}>
                    <div className="nm-bubble nm-typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} aria-hidden="true" />
              </div>
            </div>

            <footer className="nm-composer-wrap">
              <div className="nm-composer">
                <textarea
                  className="nm-input"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={t.messagePlaceholder}
                  onCompositionStart={() => {
                    composingMessageRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    composingMessageRef.current = false;
                  }}
                  onKeyDown={(event) => {
                    const nativeEvent = event.nativeEvent as KeyboardEvent;
                    if (composingMessageRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) return;
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.blur();
                      sendMessage();
                    }
                  }}
                />
                <Button
                  className={`nm-send-button px-0 disabled:!cursor-default ${isSending ? "is-stop" : ""}`}
                  onClick={isSending ? stopResponse : sendMessage}
                  aria-label={isSending ? t.stopResponse : t.sendMessage}
                  disabled={isSending ? false : !draft.trim() || !modelId || conversationIsLoading}
                >
                  {isSending ? <Square size={17} fill="currentColor" /> : <Send size={20} />}
                </Button>
              </div>
            </footer>
          </section>
        </div>
      </div>
      {toastMessage && (
        <div className={`nm-toast ${toastKind === "success" ? "is-success" : ""}`} role="alert" aria-live="polite">
          {toastKind === "success" ? <Check size={16} /> : <AlertTriangle size={16} />}
          <span>{toastMessage}</span>
        </div>
      )}
      {loginDialogOpen && (
        <Modal
          title={t.signInRequired}
          onClose={() => setLoginDialogOpen(false)}
          className="nm-login-modal max-w-sm"
          titleClassName="!text-sm !font-medium"
          hideCloseButton
          closeOnBackdrop
        >
          <LoginForm
            language={language}
            onSuccess={() => {
              setLoginDialogOpen(false);
              queryClient.invalidateQueries({ queryKey: ["me"] });
              queryClient.invalidateQueries({ queryKey: ["conversations"] });
            }}
          />
        </Modal>
      )}
    </main>
  );
}

export function MessageContent({ message }: { message: MessageDto }) {
  if (message.role !== "assistant") return <>{message.content}</>;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ children, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      }}
    >
      {message.content}
    </ReactMarkdown>
  );
}

function AccountMenuActions({
  language,
  phoneNumber,
  onRedeem,
  onLanguageChange,
  onLogout
}: {
  language: Language;
  phoneNumber: string;
  onRedeem: () => void;
  onLanguageChange: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const common = commonText[language];

  return (
    <>
      <div className="nm-account-menu-item nm-account-menu-info">
        <UserRound size={16} />
        <span>{common.account}</span>
        <span className="nm-account-menu-value">{phoneNumber}</span>
      </div>
      <button className="nm-account-menu-item" onClick={onRedeem}>
        <Ticket size={16} />
        <span>{common.redeem}</span>
      </button>
      <button className="nm-account-menu-item" onClick={onLanguageChange}>
        <Languages size={16} />
        <span>{common.language}</span>
        <span className="nm-account-menu-value">{languageLabels[language === "en" ? "zh" : "en"]}</span>
      </button>
      <button className="nm-account-menu-item" onClick={() => void onLogout()}>
        <LogOut size={16} />
        <span>{common.logout}</span>
      </button>
    </>
  );
}

function RedeemCodeMenu({ language }: { language: Language }) {
  const queryClient = useQueryClient();
  const t = chatText[language];
  const common = commonText[language];
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"error" | "success">("success");
  const redeemMutation = useMutation({
    mutationFn: (redeemCode: string) => api<{ appTokenAmount: number; appTokenBalance: number }>("/api/redeem", { method: "POST", body: JSON.stringify({ code: redeemCode }) }),
    onSuccess: (result) => {
      setCode("");
      setMessageKind("success");
      setMessage(t.addedTokens(result.appTokenAmount));
      queryClient.setQueryData<{ user: ApiUser }>(["me"], (current) =>
        current ? { user: { ...current.user, appTokenBalance: result.appTokenBalance } } : current
      );
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => {
      setMessageKind("error");
      setMessage(localizeErrorMessage(error, language, t.chatFailed));
    }
  });

  function redeem() {
    const redeemCode = code.trim();
    if (!redeemCode || redeemMutation.isPending) return;
    redeemMutation.mutate(redeemCode);
  }

  return (
    <form
      className="nm-account-redeem"
      onSubmit={(event) => {
        event.preventDefault();
        redeem();
      }}
    >
      <div className="nm-account-redeem-title">
        <Ticket size={16} />
        <span>{t.redeemCode}</span>
      </div>
      <input
        className="nm-field"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          redeem();
        }}
        placeholder={t.code}
      />
      {message && <p className={`nm-account-redeem-message ${messageKind === "success" ? "is-success" : "is-error"}`}>{message}</p>}
      <Button className="h-9 w-full rounded-[10px] text-xs" type="submit" disabled={!code.trim() || redeemMutation.isPending}>
        {redeemMutation.isPending ? <span className="nm-button-spinner" aria-hidden="true" /> : common.redeem}
      </Button>
    </form>
  );
}
