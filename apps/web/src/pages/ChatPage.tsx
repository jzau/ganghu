import type { MessageDto } from "@ai-chat/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, Check, ChevronDown, ChevronUp, Languages, LogOut, Menu, Plus, Send, Sparkles, Ticket, Trash2, Upload, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useNavigate } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { api, endpoints } from "../lib/api";
import { commonText, languageLabels, localizeErrorMessage, useLanguage, type Language } from "../lib/i18n";

const chatText = {
  en: {
    loading: "Loading",
    closeConversations: "Close conversations",
    newChat: "New chat",
    history: "History",
    openAccountMenu: "Open account menu",
    openConversations: "Open conversations",
    selectModel: "Select model",
    modelsLoading: "Models loading",
    models: "Models",
    startConversation: "Start a conversation",
    emptyHint: "Choose a model and send a message.",
    thinking: "Assistant is thinking",
    messagePlaceholder: "Message",
    sendMessage: "Send message",
    redeemCode: "Redeem code",
    code: "Code",
    addedTokens: (amount: number) => `Added ${amount} app tokens`,
    chatFailed: "Chat failed",
    shareConversation: "Share conversation",
    shareCopied: "Share link copied",
    shareFailed: "Could not create share link",
    modelLocked: "Model is locked for this conversation"
  },
  zh: {
    loading: "加载中",
    closeConversations: "关闭会话列表",
    newChat: "新建对话",
    history: "历史记录",
    openAccountMenu: "打开账户菜单",
    openConversations: "打开会话列表",
    selectModel: "选择模型",
    modelsLoading: "模型加载中",
    models: "模型",
    startConversation: "开始对话",
    emptyHint: "选择模型并发送消息。",
    thinking: "助手正在思考",
    messagePlaceholder: "输入消息",
    sendMessage: "发送消息",
    redeemCode: "兑换码",
    code: "兑换码",
    addedTokens: (amount: number) => `已添加 ${amount} 个应用代币`,
    chatFailed: "聊天失败",
    shareConversation: "分享对话",
    shareCopied: "分享链接已复制",
    shareFailed: "无法创建分享链接",
    modelLocked: "此对话已锁定模型"
  }
} as const;

const defaultConversationTitles = new Set<string>([chatText.en.newChat, chatText.zh.newChat]);

function conversationTitleForLanguage(title: string, language: Language) {
  return defaultConversationTitles.has(title) ? chatText[language].newChat : title;
}

export function ChatPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { language, setLanguage } = useLanguage();
  const t = chatText[language];
  const common = commonText[language];
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollHideTimeouts = useRef<Record<string, number>>({});
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [modelId, setModelId] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState<MessageDto | null>(null);
  const [completedAssistantMessage, setCompletedAssistantMessage] = useState<MessageDto | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [toastKind, setToastKind] = useState<"error" | "success">("error");
  const [isSending, setIsSending] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [scrollingAreas, setScrollingAreas] = useState<Record<string, boolean>>({});

  const me = useQuery({ queryKey: ["me"], queryFn: endpoints.me, retry: false });
  const models = useQuery({ queryKey: ["models"], queryFn: endpoints.models, enabled: me.isSuccess });
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: endpoints.conversations, enabled: me.isSuccess });
  const messages = useQuery({
    queryKey: ["messages", activeConversationId],
    queryFn: () => endpoints.messages(activeConversationId),
    enabled: Boolean(activeConversationId)
  });

  useEffect(() => {
    if (me.isError) navigate("/login");
  }, [me.isError, navigate]);

  useEffect(() => {
    if (!modelId && models.data?.models[0]) setModelId(models.data.models[0].id);
  }, [modelId, models.data]);

  useEffect(() => {
    if (!activeConversationId && conversations.data?.conversations[0]) {
      setActiveConversationId(conversations.data.conversations[0].id);
    }
  }, [activeConversationId, conversations.data]);

  useEffect(() => {
    if (!toastMessage) return;
    const timeoutId = window.setTimeout(() => setToastMessage(""), 4200);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  useEffect(() => {
    return () => {
      Object.values(scrollHideTimeouts.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  const allMessages = useMemo<MessageDto[]>(() => {
    const base = messages.data?.messages ?? [];
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
      return [...base, ...pending, { id: "streaming", conversationId: activeConversationId, role: "assistant", content: streamingText, modelId, createdAt: new Date().toISOString() }];
    }
    return [...base, ...pending, ...completed];
  }, [activeConversationId, completedAssistantMessage, messages.data, modelId, pendingUserMessage, streamingText]);

  const persistedMessages = messages.data?.messages ?? [];
  const conversationModelId = persistedMessages.find((message) => message.modelId)?.modelId ?? null;
  const hasPendingMessage =
    pendingUserMessage &&
    (!pendingUserMessage.conversationId || pendingUserMessage.conversationId === activeConversationId);
  const chatHasContent = persistedMessages.length > 0 || Boolean(hasPendingMessage) || Boolean(streamingText);
  const conversationIsLoading = Boolean(activeConversationId && messages.isLoading);
  const modelSelectionLocked = conversationIsLoading || chatHasContent;
  const selectedModel = models.data?.models.find((model) => model.id === modelId) ?? models.data?.models[0];
  const balance = me.data?.user.appTokenBalance ?? 0;
  const phoneNumber = me.data?.user.phoneNumber ?? "";
  const activeConversation = conversations.data?.conversations.find((conversation) => conversation.id === activeConversationId);
  const activeConversationTitle = activeConversation ? conversationTitleForLanguage(activeConversation.title, language) : t.startConversation;

  useEffect(() => {
    if (conversationModelId && modelId !== conversationModelId) setModelId(conversationModelId);
  }, [conversationModelId, modelId]);

  useEffect(() => {
    if (modelSelectionLocked) setModelMenuOpen(false);
  }, [modelSelectionLocked]);

  useEffect(() => {
    if (!activeConversationId) return;
    const frameId = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeConversationId, allMessages.length, streamingText]);

  async function sendMessage() {
    if (!draft.trim() || !modelId || isSending || conversationIsLoading) return;
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
    setPendingUserMessage(optimisticMessage);
    setCompletedAssistantMessage(null);
    setStreamingText("");
    setToastMessage("");
    setIsSending(true);
    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
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
          if (event === "delta") setStreamingText((current) => current + data.content);
          if (event === "error") throw new Error(data.message ?? t.chatFailed);
          if (event === "done") {
            setCompletedAssistantMessage(data.message);
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
      setPendingUserMessage(null);
      setStreamingText("");
      setDraft(message);
      setToastKind("error");
      setToastMessage(localizeErrorMessage(error, language, t.chatFailed));
    } finally {
      setIsSending(false);
    }
  }

  function markScrolling(area: string) {
    window.clearTimeout(scrollHideTimeouts.current[area]);
    setScrollingAreas((current) => (current[area] ? current : { ...current, [area]: true }));
    scrollHideTimeouts.current[area] = window.setTimeout(() => {
      setScrollingAreas((current) => ({ ...current, [area]: false }));
    }, 850);
  }

  const createConversation = useMutation({
    mutationFn: () => api<{ conversation: { id: string } }>("/api/conversations", { method: "POST", body: JSON.stringify({ title: chatText.en.newChat }) }),
    onSuccess: (data) => {
      setActiveConversationId(data.conversation.id);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  });

  const deleteConversation = useMutation({
    mutationFn: (id: string) => api(`/api/conversations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setActiveConversationId("");
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  });

  const shareConversation = useMutation({
    mutationFn: (id: string) => api<{ token: string }>(`/api/conversations/${id}/share`, { method: "POST" }),
    onSuccess: async (data) => {
      const url = `${window.location.origin}/share/${data.token}`;
      await window.navigator.clipboard?.writeText(url).catch(() => undefined);
      setToastKind("success");
      setToastMessage(`${t.shareCopied}: ${url}`);
    },
    onError: (error) => {
      setToastKind("error");
      setToastMessage(localizeErrorMessage(error, language, t.shareFailed));
    }
  });

  if (me.isLoading) return <main className="grid min-h-screen place-items-center bg-[#dcdde3] text-ink">{t.loading}</main>;

  return (
    <main className="nm-page">
      <div className="nm-shell">
        <div className="nm-layout">
          {sidebarOpen && <button className="nm-drawer-scrim md:hidden" aria-label={t.closeConversations} onClick={() => setSidebarOpen(false)} />}
          <aside className={`nm-sidebar ${sidebarOpen ? "is-open" : ""}`}>
            <div className="nm-brand">
              <div className="nm-logo nm-logo-mark" aria-hidden="true">⏳</div>
              <div className="nm-brand-wordmark">
                <div className={`nm-brand-title ${language === "zh" ? "is-zh" : "is-en"}`}>
                  {language === "zh" ? "工夫AI" : "GANGHU AI"}
                </div>
              </div>
            </div>

            <button className="nm-action" onClick={() => createConversation.mutate()}>
              <Plus size={16} />
              {t.newChat}
            </button>

            <div className="nm-section-label">{t.history}</div>
            <div className={`nm-history ${scrollingAreas.history ? "is-scrolling" : ""}`} onScroll={() => markScrolling("history")}>
              {conversations.data?.conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`nm-history-item group ${activeConversationId === conversation.id ? "is-active" : ""}`}
                  onClick={() => {
                    setActiveConversationId(conversation.id);
                    setSidebarOpen(false);
                  }}
                >
                  <span className="nm-dot" />
                  <span className="truncate">{conversationTitleForLanguage(conversation.title, language)}</span>
                  <Trash2
                    size={15}
                    className="ml-auto opacity-0 transition group-hover:opacity-70"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteConversation.mutate(conversation.id);
                    }}
                  />
                </button>
              ))}
            </div>

            <div className="relative">
              <button className={`nm-account ${accountMenuOpen ? "is-open" : ""}`} aria-label={t.openAccountMenu} onClick={() => setAccountMenuOpen((open) => !open)}>
                <div className="nm-avatar-sm" aria-hidden="true">
                  <UserRound size={18} />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-bold">{balance.toLocaleString()} {common.tokens}</div>
                </div>
                <ChevronUp size={15} className="shrink-0 opacity-50" />
              </button>
              {accountMenuOpen && (
                <div className={`nm-account-menu ${scrollingAreas.accountMenu ? "is-scrolling" : ""}`} onScroll={() => markScrolling("accountMenu")}>
                  <div className="nm-account-menu-item nm-account-menu-info">
                    <UserRound size={16} />
                    <span>{common.account}</span>
                    <span className="nm-account-menu-value">{phoneNumber}</span>
                  </div>
                  <button
                    className="nm-account-menu-item"
                    onClick={() => {
                      setRedeemOpen(true);
                      setAccountMenuOpen(false);
                    }}
                  >
                    <Ticket size={16} />
                    <span>{common.redeem}</span>
                  </button>
                  <button
                    className="nm-account-menu-item"
                    onClick={() => {
                      setLanguage(language === "en" ? "zh" : "en");
                      setAccountMenuOpen(false);
                    }}
                  >
                    <Languages size={16} />
                    <span>{common.language}</span>
                    <span className="nm-account-menu-value">{languageLabels[language === "en" ? "zh" : "en"]}</span>
                  </button>
                  <button
                    className="nm-account-menu-item"
                    onClick={async () => {
                      await api("/api/auth/logout", { method: "POST" });
                      navigate("/login");
                    }}
                  >
                    <LogOut size={16} />
                    <span>{common.logout}</span>
                  </button>
                </div>
              )}
            </div>
          </aside>

          <section className="nm-chat">
            <header className="nm-chat-header">
              <button className="nm-icon-button md:hidden" onClick={() => setSidebarOpen(true)} aria-label={t.openConversations}>
                <Menu size={18} />
              </button>

              <div className="relative min-w-0">
                <button
                  className={`nm-model-button ${modelMenuOpen ? "is-open" : ""}`}
                  onClick={() => {
                    if (!modelSelectionLocked) setModelMenuOpen((open) => !open);
                  }}
                  disabled={modelSelectionLocked}
                  title={modelSelectionLocked ? undefined : t.selectModel}
                >
                  <span className="nm-model-icon"><Sparkles size={17} /></span>
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm font-bold">{selectedModel?.displayName ?? t.selectModel}</span>
                    <span className="block truncate text-[11px] text-[#808080]">
                      {selectedModel?.providerModelId ?? t.modelsLoading}
                    </span>
                  </span>
                  {!modelSelectionLocked && <ChevronDown size={15} className="shrink-0 opacity-50" />}
                </button>
                {modelMenuOpen && !modelSelectionLocked && (
                  <div className={`nm-model-menu ${scrollingAreas.modelMenu ? "is-scrolling" : ""}`} onScroll={() => markScrolling("modelMenu")}>
                    <div className="nm-section-label px-2">{t.models}</div>
                    {models.data?.models.map((model) => (
                      <button
                        key={model.id}
                        className={`nm-model-option ${model.id === modelId ? "is-active" : ""}`}
                        onClick={() => {
                          setModelId(model.id);
                          setModelMenuOpen(false);
                        }}
                      >
                        <span className="nm-model-option-icon"><Bot size={15} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold">{model.displayName}</span>
                          <span className="block truncate text-[11px] text-[#808080]">{model.providerModelId}</span>
                        </span>
                        {model.id === modelId && <Check size={16} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                className="nm-icon-button ml-auto"
                onClick={() => activeConversationId && shareConversation.mutate(activeConversationId)}
                aria-label={t.shareConversation}
                title={t.shareConversation}
                disabled={!activeConversationId || shareConversation.isPending}
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
                  <div key={message.id} className={`nm-message ${message.role === "user" ? "is-user" : "is-assistant"}`}>
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
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <Button className="nm-send-button px-0" onClick={sendMessage} aria-label={t.sendMessage} disabled={!draft.trim() || !modelId || isSending || conversationIsLoading}>
                  <Send size={20} />
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
      {redeemOpen && <RedeemModal language={language} onClose={() => setRedeemOpen(false)} />}
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

function RedeemModal({ language, onClose }: { language: Language; onClose: () => void }) {
  const queryClient = useQueryClient();
  const t = chatText[language];
  const common = commonText[language];
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  async function redeem() {
    try {
      const result = await api<{ appTokenAmount: number }>("/api/redeem", { method: "POST", body: JSON.stringify({ code }) });
      setMessage(t.addedTokens(result.appTokenAmount));
      queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (error) {
      setMessage(localizeErrorMessage(error, language, t.chatFailed));
    }
  }

  return (
    <Modal title={t.redeemCode} className="nm-redeem-modal" onClose={onClose}>
      <input className="nm-field mb-3" value={code} onChange={(event) => setCode(event.target.value)} placeholder={t.code} />
      {message && <p className="mb-3 text-sm font-semibold text-[#2a2a2a]">{message}</p>}
      <Button className="w-full" onClick={redeem}>{common.redeem}</Button>
    </Modal>
  );
}
