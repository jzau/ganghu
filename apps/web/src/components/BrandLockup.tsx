import type { Language } from "../lib/i18n";

export function BrandLockup({ className = "", language }: { className?: string; language: Language }) {
  const name = language === "en" ? "GANGHU AI" : "工夫AI";

  return (
    <div className={`nm-brand-lockup ${className}`} aria-label={name}>
      <span className="nm-brand-hourglass" aria-hidden="true">⏳</span>
      <span className={`nm-brand-name ${language === "en" ? "is-en" : "is-zh"}`}>{name}</span>
    </div>
  );
}
