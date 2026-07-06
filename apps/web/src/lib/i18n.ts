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
    editName: "Edit name",
    name: "Name",
    redeem: "Redeem",
    save: "Save",
    tokens: "Tokens"
  },
  zh: {
    account: "账户",
    language: "语言",
    logout: "退出登录",
    editName: "编辑名称",
    name: "名称",
    redeem: "兑换",
    save: "保存",
    tokens: "词元"
  }
} as const;

const errorText: Record<string, Record<Language, string>> = {
  "Request failed": { en: "Request failed", zh: "请求失败" },
  "Unsupported country code": { en: "Unsupported country code", zh: "不支持的国家或地区代码" },
  "Invalid phone number for selected country": { en: "Invalid phone number for selected country", zh: "手机号不符合所选国家或地区格式" },
  "Invalid phone number": { en: "Invalid phone number", zh: "手机号无效" },
  "Invalid OTP": { en: "Invalid OTP", zh: "验证码无效" },
  "Authentication required": { en: "Authentication required", zh: "请先登录" },
  "Conversation not found": { en: "Conversation not found", zh: "未找到对话" },
  "Shared conversation not found": { en: "Shared conversation not found", zh: "未找到分享对话" },
  "Model not found": { en: "Model not found", zh: "未找到模型" },
  "Not enough app tokens": { en: "Not enough app tokens", zh: "词元余额不足" },
  "Model cannot be changed after a conversation has started": {
    en: "Model cannot be changed after a conversation has started",
    zh: "对话开始后不能更换模型"
  },
  "Chat failed": { en: "Chat failed", zh: "聊天失败" },
  "Redeem code could not be applied": { en: "Redeem code could not be applied", zh: "兑换码无法使用" },
  CODE_NOT_FOUND: { en: "Redeem code was not found", zh: "兑换码不存在" },
  CODE_DISABLED: { en: "Redeem code is disabled", zh: "兑换码已停用" },
  CODE_EXPIRED: { en: "Redeem code has expired", zh: "兑换码已过期" },
  CODE_USED_UP: { en: "Redeem code has been used up", zh: "兑换码已用完" },
  CODE_ALREADY_REDEEMED: { en: "Redeem code has already been redeemed", zh: "兑换码已兑换过" },
  REDEEM_FAILED: { en: "Redeem failed", zh: "兑换失败" }
};

export function localizeErrorMessage(error: unknown, language: Language, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  return errorText[error.message]?.[language] ?? fallback;
}
