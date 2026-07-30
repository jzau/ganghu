import type { Language } from "./i18n";

const defaultAppNames: Record<Language, string> = {
  en: "GANGHU AI",
  zh: "工夫 AI"
};

function configuredName(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

export const appNames: Record<Language, string> = {
  en: configuredName(import.meta.env.VITE_APP_NAME_EN, defaultAppNames.en),
  zh: configuredName(import.meta.env.VITE_APP_NAME_ZH, defaultAppNames.zh)
};

export function brandText(text: string, language: Language) {
  return text.replaceAll("GANGHU AI", appNames[language]);
}
