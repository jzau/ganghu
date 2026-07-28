import { env } from "../../lib/env.js";
import { prisma } from "../../lib/prisma.js";

export const searchProviderIds = ["tavily", "aliyun-iqs", "baidu-qianfan", "perplexity", "doubao-search"] as const;
export type SearchProviderId = typeof searchProviderIds[number];

const settingKey = "search.primaryProvider";

export function isSearchProviderId(value: string): value is SearchProviderId {
  return searchProviderIds.some((provider) => provider === value);
}

export function getSearchProviderAvailability(): Record<SearchProviderId, boolean> {
  return {
    tavily: Boolean(env.TAVILY_API_KEY),
    "aliyun-iqs": Boolean(env.ALIYUN_IQS_API_KEY),
    "baidu-qianfan": Boolean(env.BAIDU_QIANFAN_API_KEY),
    perplexity: Boolean(env.PERPLEXITY_API_KEY),
    "doubao-search": Boolean(env.DOUBAO_SEARCH_API_KEY)
  };
}

export async function getActiveSearchProviderId(): Promise<SearchProviderId> {
  const setting = await prisma.appSetting.findUnique({ where: { key: settingKey } });
  return setting && isSearchProviderId(setting.value)
    ? setting.value
    : env.SEARCH_PRIMARY_PROVIDER;
}

export async function setActiveSearchProviderId(provider: SearchProviderId) {
  const availability = getSearchProviderAvailability();
  if (!availability[provider]) {
    throw Object.assign(new Error(`The ${provider} API key is not configured on the server`), { statusCode: 400 });
  }
  await prisma.appSetting.upsert({
    where: { key: settingKey },
    create: { key: settingKey, value: provider },
    update: { value: provider }
  });
  return provider;
}
