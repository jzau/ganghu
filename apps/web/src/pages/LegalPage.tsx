import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { brandText } from "../lib/branding";
import { useLanguage, type Language } from "../lib/i18n";

export type LegalPageKind = "terms" | "privacy";

const legalText: Record<Language, Record<LegalPageKind, {
  title: string;
  updated: string;
  intro: string;
  sections: Array<{ heading: string; body: string[] }>;
}>> = {
  en: {
    terms: {
      title: "Terms of Service",
      updated: "Last updated: September 7, 2026",
      intro: "These Terms of Use govern your access to and use of GANGHU AI.",
      sections: [
        {
          heading: "Account Registration",
          body: [
            "You may sign in with a supported phone number and verification code. New phone numbers are automatically registered when login is completed.",
            "You are responsible for keeping access to your phone number and session secure."
          ]
        },
        {
          heading: "Acceptable Use",
          body: [
            "You agree not to misuse the service, interfere with its operation, attempt unauthorized access, or use it for unlawful, harmful, or abusive activity.",
            "We may limit, suspend, or terminate access when use creates risk for the service, other users, or GANGHU AI."
          ]
        },
        {
          heading: "AI Outputs",
          body: [
            "AI-generated responses may be inaccurate, incomplete, or inappropriate for your situation. You are responsible for reviewing outputs before relying on them.",
            "Do not use GANGHU AI as a substitute for professional advice in legal, medical, financial, or other high-stakes matters."
          ]
        },
        {
          heading: "Tokens and Access",
          body: [
            "Some models or features may require app tokens, redeem codes, or administrative access. Availability may change over time.",
            "We may update, pause, or discontinue parts of the service at any time."
          ]
        },
        {
          heading: "Contact",
          body: ["Questions about these terms can be sent to the GANGHU AI operator or administrator that provided your access."]
        }
      ]
    },
    privacy: {
      title: "Privacy Policy",
      updated: "Last updated: September 7, 2026",
      intro: "This Privacy Policy explains how GANGHU AI handles information when you use the service.",
      sections: [
        {
          heading: "Information We Collect",
          body: [
            "We collect the phone number you use to sign in, verification and session information, display names, app token balances, redeem code activity, model selections, conversations, and shared conversation links.",
            "We may also collect technical information such as timestamps, request metadata, and service logs needed to operate and protect the service."
          ]
        },
        {
          heading: "How We Use Information",
          body: [
            "We use information to authenticate users, provide chat features, manage app tokens and redeem codes, maintain conversation history, troubleshoot issues, improve reliability, and protect against misuse.",
            "Conversation content may be sent to third-party model providers when needed to generate responses."
          ]
        },
        {
          heading: "Sharing",
          body: [
            "We do not sell your personal information. We share information only with service providers, model providers, administrators, or when required to comply with law or protect the service.",
            "If you create a shared conversation link, anyone with that link may view the shared conversation content."
          ]
        },
        {
          heading: "Retention and Security",
          body: [
            "We retain information for as long as needed to provide the service, maintain records, resolve disputes, and meet operational or legal requirements.",
            "We use reasonable safeguards, but no internet service can be guaranteed to be perfectly secure."
          ]
        },
        {
          heading: "Your Choices",
          body: ["Contact the GANGHU AI operator or administrator that provided your access to request help with account or data questions."]
        }
      ]
    }
  },
  zh: {
    terms: {
      title: "使用条款",
      updated: "最后更新：2026 年 9 月 7 日",
      intro: "本使用条款适用于您访问和使用 GANGHU AI。",
      sections: [
        {
          heading: "账户注册",
          body: [
            "您可以使用支持的手机号码和验证码登录。新的手机号码完成登录后将自动注册。",
            "您有责任保护手机号码和登录会话的安全。"
          ]
        },
        {
          heading: "可接受使用",
          body: [
            "您同意不滥用服务、不干扰服务运行、不尝试未经授权的访问，也不将服务用于违法、有害或滥用性活动。",
            "当使用行为给服务、其他用户或 GANGHU AI 带来风险时，我们可能限制、暂停或终止访问。"
          ]
        },
        {
          heading: "AI 输出",
          body: [
            "AI 生成的回复可能不准确、不完整，或不适合您的具体情况。您应在依赖输出前自行审查。",
            "请勿将 GANGHU AI 作为法律、医疗、金融或其他高风险事项中专业意见的替代。"
          ]
        },
        {
          heading: "词元和访问",
          body: [
            "部分模型或功能可能需要应用词元、兑换码或管理员访问权限。可用性可能随时间变化。",
            "我们可能随时更新、暂停或停止服务的部分内容。"
          ]
        },
        {
          heading: "联系",
          body: ["如对本条款有疑问，请联系向您提供访问权限的 GANGHU AI 运营方或管理员。"]
        }
      ]
    },
    privacy: {
      title: "隐私政策",
      updated: "最后更新：2026 年 9 月 7 日",
      intro: "本隐私政策说明您使用 GANGHU AI 时，服务如何处理相关信息。",
      sections: [
        {
          heading: "我们收集的信息",
          body: [
            "我们会收集您用于登录的手机号码、验证和会话信息、显示名称、应用词元余额、兑换码活动、模型选择、对话内容以及分享对话链接。",
            "我们也可能收集运行和保护服务所需的技术信息，例如时间戳、请求元数据和服务日志。"
          ]
        },
        {
          heading: "信息使用方式",
          body: [
            "我们使用信息来验证用户身份、提供聊天功能、管理应用词元和兑换码、维护对话历史、排查问题、提升可靠性并防止滥用。",
            "为生成回复，对话内容可能会在必要时发送给第三方模型提供商。"
          ]
        },
        {
          heading: "共享",
          body: [
            "我们不会出售您的个人信息。我们仅在服务提供商、模型提供商、管理员需要时，或为遵守法律、保护服务而共享信息。",
            "如果您创建分享对话链接，拥有该链接的任何人都可能查看被分享的对话内容。"
          ]
        },
        {
          heading: "保留和安全",
          body: [
            "我们会在提供服务、维护记录、解决争议以及满足运营或法律要求所需的期限内保留信息。",
            "我们会采取合理保护措施，但任何互联网服务都无法保证绝对安全。"
          ]
        },
        {
          heading: "您的选择",
          body: ["如需处理账户或数据相关问题，请联系向您提供访问权限的 GANGHU AI 运营方或管理员。"]
        }
      ]
    }
  }
};

export function LegalPage({ kind }: { kind: LegalPageKind }) {
  const { language } = useLanguage();
  const navigate = useNavigate();

  return (
    <div className="gg-legal-page">
      <header className="gg-legal-page-header">
        <button className="gg-legal-close" onClick={() => { if (window.history.length > 1) navigate(-1); else navigate("/login"); }} aria-label={language === "en" ? "Close" : "关闭"}><X size={18} /></button>
      </header>
      <main className="gg-legal-scroll" id="main-content">
        <article className="gg-legal-document">
          <h1>{legalText[language][kind].title}</h1>
          <LegalContent kind={kind} language={language} />
        </article>
      </main>
    </div>
  );
}

export function LegalContent({ kind, language }: { kind: LegalPageKind; language: Language }) {
  const page = legalText[language][kind];
  return (
    <div className="gg-legal-content">
      <p className="gg-legal-updated">{page.updated}</p>
      <p className="gg-legal-intro">{brandText(page.intro, language)}</p>
      {page.sections.map((section, index) => (
        <section key={section.heading}>
          <h2>{kind === "terms" ? `${index + 1}. ${section.heading}` : section.heading}</h2>
          {section.body.map((paragraph) => <p key={paragraph}>{brandText(paragraph, language)}</p>)}
        </section>
      ))}
      <footer>GANGRAM · <a href="mailto:support@gangram.com">support@gangram.com</a></footer>
    </div>
  );
}
