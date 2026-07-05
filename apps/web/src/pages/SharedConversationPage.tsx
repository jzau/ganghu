import { useQuery } from "@tanstack/react-query";
import { Bot, Link2, UserRound } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { MessageContent } from "./ChatPage";
import { endpoints } from "../lib/api";
import { appNames, useLanguage } from "../lib/i18n";

const sharedText = {
  en: {
    loading: "Loading shared conversation",
    notFound: "Shared conversation not found",
    openApp: "Open app",
    sharedConversation: "Shared conversation",
    empty: "This shared conversation has no messages yet."
  },
  zh: {
    loading: "正在加载分享对话",
    notFound: "未找到分享对话",
    openApp: "打开应用",
    sharedConversation: "分享对话",
    empty: "这个分享对话还没有消息。"
  }
} as const;

export function SharedConversationPage() {
  const { token = "" } = useParams();
  const { language } = useLanguage();
  const t = sharedText[language];
  const shared = useQuery({
    queryKey: ["shared-conversation", token],
    queryFn: () => endpoints.sharedConversation(token),
    enabled: Boolean(token),
    retry: false
  });

  if (shared.isLoading) return <main className="grid min-h-screen place-items-center bg-[#dcdde3] text-ink">{t.loading}</main>;

  if (shared.isError || !shared.data) {
    return (
      <main className="nm-page">
        <div className="nm-shared-shell">
          <section className="nm-chat">
            <div className="nm-empty">
              <div className="nm-empty-icon"><Link2 size={22} /></div>
              <div className="font-bold">{t.notFound}</div>
              <Link className="nm-shared-link" to="/">{t.openApp}</Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const { conversation, messages } = shared.data.share;

  return (
    <main className="nm-page">
      <div className="nm-shared-shell">
        <section className="nm-chat">
          <header className="nm-chat-header">
            <div className="nm-shared-brand">
              <div className="nm-logo" aria-hidden="true">⏳</div>
              <div className="min-w-0">
                <div className="nm-title">{appNames[language]}</div>
                <div className="nm-subtitle">{t.sharedConversation}</div>
              </div>
            </div>
            <Link className="nm-shared-link ml-auto" to="/">{t.openApp}</Link>
          </header>

          <div className="nm-shared-title">
            <h1>{conversation.title}</h1>
          </div>

          <div className="nm-messages">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
              {messages.length === 0 && (
                <div className="nm-empty">
                  <div className="nm-empty-icon"><Bot size={22} /></div>
                  <div className="mt-1 text-sm text-[#808080]">{t.empty}</div>
                </div>
              )}
              {messages.map((message) => (
                <div key={message.id} className={`nm-message ${message.role === "user" ? "is-user" : "is-assistant"}`}>
                  <div className="nm-message-avatar">{message.role === "user" ? <UserRound size={15} /> : <Bot size={15} />}</div>
                  <div className="nm-bubble">
                    <MessageContent message={message} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
