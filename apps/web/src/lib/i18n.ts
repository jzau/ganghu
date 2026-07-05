import { useEffect, useState } from "react";

export type Language = "en" | "zh";

const languageKey = "ganghu-language";

export const appNames: Record<Language, string> = {
  en: "GANGHU AI",
  zh: "工夫AI"
};

export const languageLabels: Record<Language, string> = {
  en: "English",
  zh: "简体中文"
};

export function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem(languageKey) === "zh" ? "zh" : "en";
}

export function useLanguage() {
  const [language, setLanguageState] = useState<Language>(() => getInitialLanguage());

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-Hans" : "en";
    document.title = appNames[language];
    window.localStorage.setItem(languageKey, language);
  }, [language]);

  function setLanguage(nextLanguage: Language) {
    setLanguageState(nextLanguage);
  }

  return { language, setLanguage };
}

export const commonText = {
  en: {
    account: "Account",
    language: "Language",
    logout: "Log out",
    redeem: "Redeem",
    tokens: "tokens"
  },
  zh: {
    account: "账户",
    language: "语言",
    logout: "退出登录",
    redeem: "兑换",
    tokens: "代币"
  }
} as const;
