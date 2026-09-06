import { appNames, type Language } from "../lib/i18n";

export function BrandLockup({ className = "", language }: { className?: string; language: Language }) {
  const name = appNames[language];

  return (
    <div className={`nm-brand-lockup ${className}`} aria-label={name}>
      <span className={`nm-brand-name ${language === "en" ? "is-en" : "is-zh"}`}>GANGRAM</span>
    </div>
  );
}
