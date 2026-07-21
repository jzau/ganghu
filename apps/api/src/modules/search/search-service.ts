import { env } from "../../lib/env.js";
import type { SearchExecution, SearchMode, SearchRequest } from "./contracts.js";
import { TavilyProvider } from "./providers/tavily-provider.js";
import { SearchGateway } from "./search-gateway.js";

const gateway = new SearchGateway(new TavilyProvider(env.TAVILY_API_KEY, env.TAVILY_BASE_URL), env.SEARCH_TIMEOUT_MS);

export function isPlatformSearchConfigured() {
  return Boolean(env.TAVILY_API_KEY);
}

export function resolveSearchMode(input: { searchMode?: SearchMode; webSearch?: boolean }): SearchMode {
  return input.searchMode ?? (input.webSearch ? "explicit" : "off");
}

export function shouldSearchAutomatically(message: string) {
  return /\b(latest|current|currently|today|tonight|yesterday|tomorrow|recent|recently|news|breaking|live|price|weather|score|schedule|release date|version|as of|this (?:week|month|year)|who is (?:the )?(?:president|ceo))\b|最新|目前|当前|今天|昨日|昨天|明天|近期|最近|新闻|实时|价格|天气|比分|赛程|发布|版本|现任|截至/u.test(message);
}

export async function searchForMessage(input: {
  message: string;
  signal: AbortSignal;
  deadline: number;
  maxResults?: number;
}): Promise<SearchExecution> {
  const request: SearchRequest = {
    query: input.message.trim().slice(0, 400),
    maxResults: Math.min(Math.max(input.maxResults ?? env.SEARCH_MAX_RESULTS, 1), 8)
  };
  return gateway.search(request, { signal: input.signal, deadline: input.deadline });
}

