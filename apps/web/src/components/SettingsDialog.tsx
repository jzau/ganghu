import { ArrowLeft, Check, ChevronRight, FileText, Globe, MessageSquare, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Language } from "../lib/i18n";
import { LegalContent } from "../pages/LegalPage";

const labels = {
  en: {
    settings: "Settings", close: "Close settings", language: "Language", feedback: "Feedback",
    terms: "Terms of Service", privacy: "Privacy Policy", preferences: "Preferences", support: "Support & Legal"
  },
  zh: {
    settings: "设置", close: "关闭设置", language: "语言", feedback: "反馈",
    terms: "服务条款", privacy: "隐私政策", preferences: "偏好设置", support: "支持与法律"
  }
} as const;

type Section = "language" | "feedback" | "terms" | "privacy";
type Props = {
  language: Language;
  onLanguageChange: (language: Language) => void;
  onClose: () => void;
};

export function SettingsDialog({ language, onLanguageChange, onClose }: Props) {
  const t = labels[language];
  const [section, setSection] = useState<Section>("language");
  const [mobilePanel, setMobilePanel] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]') ?? [])
        .filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);

  const groups = [
    { name: t.preferences, items: [{ id: "language", icon: Globe }] },
    { name: t.support, items: [{ id: "feedback", icon: MessageSquare }, { id: "terms", icon: FileText }, { id: "privacy", icon: ShieldCheck }] }
  ] as const;

  return createPortal(
    <div className="gg-settings-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`gg-settings ${mobilePanel ? "is-panel-open" : ""}`} role="dialog" aria-modal="true" aria-label={t.settings} tabIndex={-1} ref={dialog}>
        <nav className="gg-settings-nav" aria-label={t.settings}>
          <h1>{t.settings}</h1>
          <button className="gg-settings-mobile-close nm-icon-button" onClick={onClose} aria-label={t.close}><X size={18} /></button>
          <div className="gg-settings-nav-scroll">
            {groups.map((group) => <div className="gg-settings-group" key={group.name}>
              <p className="gg-eyebrow">{group.name}</p>
              {group.items.map(({ id, icon: Icon }) => <button key={id} aria-current={section === id ? "page" : undefined} className={`gg-settings-nav-item ${section === id ? "is-active" : ""}`} onClick={() => { setSection(id); setMobilePanel(true); }}><Icon size={16} /><span>{t[id]}</span><ChevronRight className="gg-settings-nav-chevron" size={14} /></button>)}
            </div>)}
          </div>
        </nav>
        <section className="gg-settings-pane">
          <header className="gg-settings-heading">
            <button className="gg-settings-back nm-icon-button" onClick={() => setMobilePanel(false)} aria-label={t.settings}><ArrowLeft size={18} /></button>
            <h2>{t[section]}</h2>
            <button className="nm-icon-button" onClick={onClose} aria-label={t.close}><X size={18} /></button>
          </header>
          <div className="gg-settings-content" key={section}>
            {section === "language" && <div className="gg-settings-card">{(["en", "zh"] as const).map((value) => <button className="gg-language-row" key={value} aria-pressed={language === value} onClick={() => onLanguageChange(value)}><span>{value === "en" ? "English" : "简体中文"}</span>{language === value && <Check size={16} />}</button>)}</div>}
            {(section === "terms" || section === "privacy") && <LegalContent kind={section} language={language} />}
            {section === "feedback" && <div className="gg-feedback-panel"><p>{language === "en" ? "Something not working, or a suggestion on your mind? Email us directly — every message reaches the team." : "遇到问题或有任何建议？欢迎直接发送邮件，每一封邮件都会由团队查看。"}</p><p className="gg-eyebrow">{language === "en" ? "Contact us" : "联系我们"}</p><a className="gg-text-action" href="mailto:support@gangram.com">support@gangram.com</a></div>}
          </div>
        </section>
      </div>
    </div>, document.body
  );
}
