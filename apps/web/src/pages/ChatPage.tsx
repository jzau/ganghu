import type { MessageDto } from "@ai-chat/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bot, Check, ChevronDown, LogOut, Menu, Plus, Send, Sparkles, Ticket, Trash2, UserRound, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useNavigate } from "react-router-dom";
import remarkGfm from "remark-gfm";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { api, endpoints } from "../lib/api";

export function ChatPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [modelId, setModelId] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState<MessageDto | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

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
    return streamingText
      ? [...base, ...pending, { id: "streaming", conversationId: activeConversationId, role: "assistant", content: streamingText, modelId, createdAt: new Date().toISOString() }]
      : [...base, ...pending];
  }, [activeConversationId, messages.data, modelId, pendingUserMessage, streamingText]);

  const selectedModel = models.data?.models.find((model) => model.id === modelId) ?? models.data?.models[0];
  const balance = me.data?.user.appTokenBalance ?? 0;
  const activeConversation = conversations.data?.conversations.find((conversation) => conversation.id === activeConversationId);

  useEffect(() => {
    if (!activeConversationId) return;
    const frameId = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeConversationId, allMessages.length, isSending, streamingText]);

  async function sendMessage() {
    if (!draft.trim() || !modelId || isSending) return;
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
        const error = await response.json().catch(() => ({ message: "Chat failed" }));
        throw new Error(error.message ?? "Chat failed");
      }
      if (!response.body) throw new Error("Chat failed");

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
          if (event === "error") throw new Error(data.message ?? "Chat failed");
          if (event === "done") {
            setStreamingText("");
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
      setToastMessage(error instanceof Error ? error.message : "Chat failed");
    } finally {
      setIsSending(false);
    }
  }

  const createConversation = useMutation({
    mutationFn: () => api<{ conversation: { id: string } }>("/api/conversations", { method: "POST", body: JSON.stringify({ title: "New chat" }) }),
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

  if (me.isLoading) return <main className="grid min-h-screen place-items-center bg-[#dcdde3] text-ink">Loading</main>;

  return (
    <main className="nm-page">
      <div className="nm-shell">
        <div className="nm-layout">
          {sidebarOpen && <button className="nm-drawer-scrim md:hidden" aria-label="Close conversations" onClick={() => setSidebarOpen(false)} />}
          <aside className={`nm-sidebar ${sidebarOpen ? "is-open" : ""}`}>
            <div className="nm-brand">
              <div className="nm-logo">G</div>
              <div>
                <div className="nm-title">GANGHU AI</div>
                <div className="nm-subtitle">工夫</div>
              </div>
            </div>

            <button className="nm-action" onClick={() => createConversation.mutate()}>
              <Plus size={16} />
              New chat
            </button>

            <div className="nm-section-label">History</div>
            <div className="nm-history">
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
                  <span className="truncate">{conversation.title}</span>
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

            <div className="nm-account">
              <div className="nm-avatar-sm" aria-hidden="true">
                <UserRound size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{me.data?.user.phoneNumber ?? "Account"}</div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-[#808080]">
                  <span className="nm-badge">PRO</span>
                  <span>{balance.toLocaleString()} tokens</span>
                </div>
              </div>
            </div>
          </aside>

          <section className="nm-chat">
            <header className="nm-chat-header">
              <button className="nm-icon-button md:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open conversations">
                <Menu size={18} />
              </button>

              <div className="relative min-w-0">
                <button className={`nm-model-button ${modelMenuOpen ? "is-open" : ""}`} onClick={() => setModelMenuOpen((open) => !open)}>
                  <span className="nm-model-icon"><Sparkles size={17} /></span>
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm font-bold">{selectedModel?.displayName ?? "Select model"}</span>
                    <span className="block truncate text-[11px] text-[#808080]">
                      {selectedModel?.providerModelId ?? "Models loading"}
                    </span>
                  </span>
                  <ChevronDown size={15} className="shrink-0 opacity-50" />
                </button>
                {modelMenuOpen && (
                  <div className="nm-model-menu">
                    <div className="nm-section-label px-2">Models</div>
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

              <div className="ml-auto hidden items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-[#2a2a2a] shadow-nm-in sm:flex">
                <Wallet size={16} />
                {balance.toLocaleString()}
              </div>
              <Button variant="secondary" onClick={() => setRedeemOpen(true)}>
                <Ticket size={16} /> Redeem
              </Button>
              <Button
                variant="ghost"
                className="h-10 w-10 px-0"
                aria-label="Log out"
                onClick={async () => {
                  await api("/api/auth/logout", { method: "POST" });
                  navigate("/login");
                }}
              >
                <LogOut size={17} />
              </Button>
            </header>

            <div className="nm-messages">
              <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
                {allMessages.length === 0 && (
                  <div className="nm-empty">
                    <div className="nm-empty-icon"><Bot size={22} /></div>
                    <div className="font-bold">{activeConversation?.title ?? "Start a conversation"}</div>
                    <div className="mt-1 text-sm text-[#808080]">Choose a model and send a message.</div>
                  </div>
                )}
                {allMessages.map((message) => (
                  <div key={message.id} className={`nm-message ${message.role === "user" ? "is-user" : "is-assistant"}`}>
                    <div className="nm-message-avatar">{message.role === "user" ? <UserRound size={15} /> : <Bot size={15} />}</div>
                    <div className="nm-bubble">
                      <MessageContent message={message} />
                    </div>
                  </div>
                ))}
                {isSending && !streamingText && (
                  <div className="nm-message is-assistant is-loading" aria-live="polite" aria-label="Assistant is thinking">
                    <div className="nm-message-avatar"><Bot size={15} /></div>
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
                  placeholder="Message"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <Button className="h-11 w-11 rounded-[14px] px-0" onClick={sendMessage} aria-label="Send message" disabled={!draft.trim() || !modelId || isSending}>
                  <Send size={18} />
                </Button>
              </div>
            </footer>
          </section>
        </div>
      </div>
      {toastMessage && (
        <div className="nm-toast" role="alert" aria-live="polite">
          <AlertTriangle size={16} />
          <span>{toastMessage}</span>
        </div>
      )}
      {redeemOpen && <RedeemModal onClose={() => setRedeemOpen(false)} />}
    </main>
  );
}

function MessageContent({ message }: { message: MessageDto }) {
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

function RedeemModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  async function redeem() {
    const result = await api<{ appTokenAmount: number }>("/api/redeem", { method: "POST", body: JSON.stringify({ code }) });
    setMessage(`Added ${result.appTokenAmount} app tokens`);
    queryClient.invalidateQueries({ queryKey: ["me"] });
  }

  return (
    <Modal title="Redeem code" onClose={onClose}>
      <input className="nm-field mb-3" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Code" />
      {message && <p className="mb-3 text-sm font-semibold text-[#2a2a2a]">{message}</p>}
      <Button className="w-full" onClick={redeem}>Redeem</Button>
    </Modal>
  );
}
