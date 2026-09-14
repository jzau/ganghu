import { useEffect, useState } from "react";
import { appNames } from "./branding";

export type Language = "en" | "zh";

const languageKey = "ganghu-language";
export { appNames } from "./branding";

export const languageLabels: Record<Language, string> = {
  en: "English",
  zh: "简体中文"
};

export function getInitialLanguage(): Language {
  if (typeof window === "undefined") return "en";

  const savedLanguage = window.localStorage.getItem(languageKey);
  if (savedLanguage === "en" || savedLanguage === "zh") return savedLanguage;

  const systemLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return systemLanguages.some((systemLanguage) => systemLanguage.toLowerCase().startsWith("zh")) ? "zh" : "en";
}

export function useLanguage() {
  const [language, setLanguageState] = useState<Language>(() => getInitialLanguage());

  useEffect(() => {
    const metadataAppName = appNames[language];
    document.documentElement.lang = language === "zh" ? "zh-Hans" : "en";
    document.title = metadataAppName;
    updateMetaContent("name", "apple-mobile-web-app-title", metadataAppName);
    updateMetaContent("property", "og:title", metadataAppName);
    updateMetaContent("property", "og:site_name", metadataAppName);
    window.localStorage.setItem(languageKey, language);
  }, [language]);

  function setLanguage(nextLanguage: Language) {
    setLanguageState(nextLanguage);
  }

  return { language, setLanguage };
}

function updateMetaContent(attribute: "name" | "property", value: string, content: string) {
  document.querySelector<HTMLMetaElement>(`meta[${attribute}="${value}"]`)?.setAttribute("content", content);
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
  "Authentication service unavailable": { en: "Authentication service unavailable. Please try again later.", zh: "认证服务暂不可用，请稍后重试。" },
  "Authentication required": { en: "Authentication required", zh: "请先登录" },
  "This phone number is already linked to your account": { en: "This phone number is already linked to your account", zh: "该手机号已绑定至您的账户" },
  "This phone number is already in use": { en: "This phone number is already in use", zh: "该手机号已被使用" },
  "Invalid phone number or OTP": { en: "Invalid phone number or verification code", zh: "手机号或验证码无效" },
  "Conversation not found": { en: "Conversation not found", zh: "未找到对话" },
  "Shared conversation not found": { en: "Shared conversation not found", zh: "未找到分享对话" },
  "Model not found": { en: "Model not found", zh: "未找到模型" },
  "Not enough app tokens": { en: "Not enough app tokens", zh: "词元余额不足" },
  "Model cannot be changed after a conversation has started": {
    en: "Model cannot be changed after a conversation has started",
    zh: "对话开始后不能更换模型"
  },
  "Chat failed": { en: "Chat failed", zh: "聊天失败" },
  gift_card_not_found: { en: "Gift card is invalid", zh: "礼品卡无效" },
  gift_card_unavailable: { en: "Gift card has already been redeemed or is unavailable", zh: "礼品卡已兑换或不可用" },
  gift_card_expired: { en: "Gift card has expired", zh: "礼品卡已过期" },
  TOKING_NOT_CONFIGURED: { en: "Toking redemption is not configured", zh: "尚未配置 Toking 兑换服务" },
  TOKING_UNAVAILABLE: { en: "Toking is temporarily unavailable. Please try again.", zh: "Toking 暂时不可用，请重试。" },
  TOKING_INVALID_RESPONSE: { en: "Toking returned an invalid response", zh: "Toking 返回了无效响应" },
  TOKING_ACCOUNT_MISMATCH: { en: "The Toking account could not be matched", zh: "无法匹配 Toking 账户" },
  TOKING_CREDENTIAL_RECOVERY_REQUIRED: { en: "The Toking connection needs support to recover its API key", zh: "Toking 连接需要联系客服恢复 API 密钥" },
  TOKING_CREDENTIAL_INVALID: { en: "The saved Toking connection is unavailable. Contact support.", zh: "已保存的 Toking 连接不可用，请联系客服。" },
  REDEEM_FAILED: { en: "Gift card redemption failed", zh: "礼品卡兑换失败" }
};

export function localizeErrorMessage(error: unknown, language: Language, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  return errorText[error.message]?.[language] ?? error.message ?? fallback;
}
