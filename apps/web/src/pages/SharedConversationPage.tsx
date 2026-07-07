import { useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useParams } from "react-router-dom";
import { MessageContent } from "./ChatPage";
import { BrandLockup } from "../components/BrandLockup";
import { endpoints } from "../lib/api";
import { useLanguage } from "../lib/i18n";

const sharedText = {
  en: {
    loading: "Loading shared conversation",
    notFound: "Shared conversation not found",
    sharedConversation: "Shared conversation",
    empty: "This shared conversation has no messages yet."
  },
  zh: {
    loading: "正在加载分享对话",
    notFound: "未找到分享对话",
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
              <BrandLockup language={language} />
              <div className="min-w-0">
                <div className="nm-subtitle">{t.sharedConversation}</div>
              </div>
            </div>
          </header>

          <div className="nm-shared-title">
            <h1>{conversation.title}</h1>
          </div>

          <div className="nm-messages">
            <div className="nm-message-column">
              {messages.length === 0 && (
                <div className="nm-empty">
                  <div className="nm-empty-icon nm-logo-mark" aria-hidden="true">⏳</div>
                  <div className="mt-1 text-sm text-[#808080]">{t.empty}</div>
                </div>
              )}
              {messages.map((message) => (
                <div key={message.id} className={`nm-message ${message.role === "user" ? "is-user" : "is-assistant"}`}>
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
