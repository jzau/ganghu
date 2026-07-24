import { env } from "../../lib/env.js";
import type { SearchExecution, SearchMode, SearchRequest, SearchResult } from "./contracts.js";
import { TavilyProvider } from "./providers/tavily-provider.js";
import { SearchGateway } from "./search-gateway.js";

const gateway = new SearchGateway(new TavilyProvider(env.TAVILY_API_KEY, env.TAVILY_BASE_URL), env.SEARCH_TIMEOUT_MS);

export function isPlatformSearchConfigured() {
  return Boolean(env.TAVILY_API_KEY);
}

export function resolveSearchMode(input: { searchMode?: SearchMode }): SearchMode {
  return input.searchMode ?? "auto";
}

export type SearchCategory = "weather" | "news" | "price" | "sports" | "general";

export interface AutoSearchPlan {
  needsSearch: boolean;
  query?: string;
  queries?: string[];
  freshness?: SearchRequest["freshness"];
  category?: SearchCategory;
  responseStyle?: "concise" | "news_digest" | "detailed";
  confidence?: number;
  planner?: "llm" | "rules";
  reason: "explicit_request" | "fresh_information" | "no_search_needed";
}

export interface SearchConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const explicitSearchPattern = /^\s*(?:please\s+)?(?:search|google)\b|\b(?:can|could|would|will) you (?:search|look up|find|browse)\b|\b(?:look up|find online|browse the web)\b|搜索|查一下|查找|上网查/iu;
const freshnessPattern = /\b(latest|current|currently|today|tonight|yesterday|tomorrow|recent|recently|breaking|live|as of|this (?:week|month|year))\b|最新|目前|当前|今天|今日|今晚|昨日|昨天|明天|近期|最近|实时|截至/iu;
const currentRolePattern = /\bwho is (?:the )?(?:president|prime minister|ceo|chair(?:man|woman|person)?)\b|现任/iu;
const weatherPattern = /\b(weather|forecast|temperature|rain(?:ing)?|snow(?:ing)?|sunny|cloudy|humidity)\b|天气|天气预报|气温|温度|下雨|下雪/iu;
const weatherExplanationPattern = /\b(why|explain|what causes|weather science|weather meaning|weather definition|how (?:does|do) (?:the )?weather (?:work|form|change))\b|为什么|解释|原理|定义/iu;
const newsPattern = /\b(news|headline|breaking|what happened)\b|新闻|头条|发生了什么/iu;
const pricePattern = /\b(price|stock price|share price|market cap|exchange rate|worth|trading at)\b|价格|股价|市值|汇率/iu;
const sportsPattern = /\b(score|standings|schedule|fixture|match result|game result)\b|比分|排名|赛程|赛果/iu;
const versionPattern = /\b(latest|current) (?:release|version)|release date\b|最新版本|当前版本|发布日期/iu;
const followUpPattern = /^\s*(?:what|how) about\b|^\s*(?:and|for)\b|^\s*(?:那|那么|还有|明天|今天|今晚)/iu;
const broadNewsPattern = /^\s*(?:(?:today'?s?|latest)\b.{0,40}\bnews|news\b.{0,40}\b(?:today|latest)|news|(?:今天|今日|最新).{0,20}(?:新闻|要闻))\s*[?？!！]?\s*$/iu;

export function planAutomaticSearch(input: {
  message: string;
  recentMessages?: SearchConversationMessage[];
}): AutoSearchPlan {
  const message = input.message.trim();
  const previousUserMessage = findPreviousUserMessage(input.recentMessages, message);
  const contextText = followUpPattern.test(message) && previousUserMessage
    ? `${previousUserMessage} ${message}`
    : message;
  const category = detectCategory(contextText);
  const explicitlyRequested = explicitSearchPattern.test(message);
  const isFresh = freshnessPattern.test(message) || currentRolePattern.test(message) || versionPattern.test(message);
  const currentWeather = category === "weather" && !weatherExplanationPattern.test(message);
  const currentVertical = category === "news" || category === "price" || category === "sports";
  const needsSearch = explicitlyRequested || isFresh || currentWeather || currentVertical;

  if (!needsSearch) return { needsSearch: false, reason: "no_search_needed" };

  const queries = buildSearchQueries(contextText, category);
  return {
    needsSearch: true,
    query: queries[0],
    queries,
    freshness: selectFreshness(category, message),
    category,
    reason: explicitlyRequested ? "explicit_request" : "fresh_information"
  };
}

export function shouldSearchAutomatically(message: string) {
  return planAutomaticSearch({ message }).needsSearch;
}

export async function searchForPlan(input: {
  plan: AutoSearchPlan;
  signal: AbortSignal;
  deadline: number;
  maxResults?: number;
}): Promise<SearchExecution> {
  if (!input.plan.needsSearch || !input.plan.query) {
    throw new Error("A searchable auto-search plan is required");
  }

  const startedAt = Date.now();
  const requests = buildSearchRequests(input.plan, input.maxResults);
  const attempts = await Promise.allSettled(
    requests.map((request) => gateway.search(request, { signal: input.signal, deadline: input.deadline }))
  );
  const executions = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
  if (!executions.length) {
    const failure = attempts.find((attempt) => attempt.status === "rejected");
    throw failure && failure.status === "rejected" ? failure.reason : new Error("Search returned no executions");
  }

  const resultLimit = input.plan.category === "news"
    ? Math.min(Math.max(input.maxResults ?? env.SEARCH_MAX_RESULTS, 1) + 3, 8)
    : Math.min(Math.max(input.maxResults ?? env.SEARCH_MAX_RESULTS, 1), 8);
  const combinedResults = executions.flatMap((execution) => execution.results);
  return {
    results: filterResultsForPlan(combinedResults, input.plan).slice(0, resultLimit),
    provider: executions[0].provider,
    durationMs: Date.now() - startedAt,
    fallbackUsed: executions.some((execution) => execution.fallbackUsed),
    requestId: executions.map((execution) => execution.requestId).filter(Boolean).join(",") || undefined,
    cost: sumSearchCosts(executions.map((execution) => execution.cost))
  };
}

export async function searchForMessage(input: {
  message: string;
  signal: AbortSignal;
  deadline: number;
  maxResults?: number;
}): Promise<SearchExecution> {
  return searchForPlan({
    ...input,
    plan: {
      needsSearch: true,
      query: input.message,
      reason: "explicit_request"
    }
  });
}

function detectCategory(message: string): SearchCategory {
  if (weatherPattern.test(message)) return "weather";
  if (newsPattern.test(message)) return "news";
  if (pricePattern.test(message)) return "price";
  if (sportsPattern.test(message)) return "sports";
  return "general";
}

function selectFreshness(category: SearchCategory, message: string): SearchRequest["freshness"] {
  if (category === "weather" || category === "price" || category === "sports") return "day";
  if (/\b(today|tonight|breaking|live)\b|今天|今日|今晚|实时/iu.test(message)) return "day";
  if (category === "news" || /\b(latest|recent|this week)\b|最新|近期|最近/iu.test(message)) return "week";
  if (freshnessPattern.test(message) || currentRolePattern.test(message) || versionPattern.test(message)) return "month";
  return undefined;
}

function buildSearchQueries(message: string, category: SearchCategory) {
  const primaryQuery = buildSearchQuery(message, category);
  if (category !== "news" || !broadNewsPattern.test(message)) return [primaryQuery];

  if (/\p{Script=Han}/u.test(message)) {
    if (!/^\s*(?:今天的?新闻|今日新闻|最新新闻)\s*[?？!！]?\s*$/u.test(message)) {
      return [primaryQuery, `${message} 政治社会`, `${message} 财经科技`, `${message} 重大要闻`];
    }
    return [primaryQuery, "今日中国重要新闻", "今日国际重大新闻", "今日财经科技新闻"];
  }
  if (!/^\s*(?:today'?s news|news today|latest news|news)\s*[?？!！]?\s*$/iu.test(message)) {
    return [primaryQuery, `${message} politics and society`, `${message} business and technology`];
  }
  return [primaryQuery, "top world news today", "top business and technology news today"];
}

function buildSearchQuery(message: string, category: SearchCategory) {
  if (category === "weather") return `${message} official weather forecast`;
  if (category === "price") return `${message} current market data`;
  if (category === "sports") return `${message} official score or schedule`;
  return message;
}

export function buildSearchRequests(plan: AutoSearchPlan, maxResults = env.SEARCH_MAX_RESULTS): SearchRequest[] {
  const queries = plan.queries?.length ? plan.queries : plan.query ? [plan.query] : [];
  const boundedMaxResults = Math.min(Math.max(maxResults, 1), plan.category === "news" ? 5 : 8);
  return queries.slice(0, 4).map((query) => ({
    query: query.trim().slice(0, 400),
    maxResults: boundedMaxResults,
    freshness: plan.freshness,
    ...(plan.category === "news" ? {
      topic: "news" as const,
      searchDepth: "basic" as const,
      includeRawContent: "markdown" as const
    } : {})
  }));
}

function sumSearchCosts(costs: Array<string | undefined>) {
  const parsed = costs.flatMap((cost) => {
    if (cost === undefined) return [];
    const value = Number(cost);
    return Number.isFinite(value) ? [value] : [];
  });
  return parsed.length ? String(parsed.reduce((total, cost) => total + cost, 0)) : undefined;
}

function findPreviousUserMessage(messages: SearchConversationMessage[] | undefined, currentMessage: string) {
  if (!messages) return undefined;
  let skippedCurrentMessage = false;
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    if (!skippedCurrentMessage && message.content.trim() === currentMessage) {
      skippedCurrentMessage = true;
      continue;
    }
    return message.content.trim();
  }
  return undefined;
}

const lowQualityCurrentSourceHosts = [
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "reddit.com"
];

const nonNewsReferenceHosts = [
  "wikipedia.org",
  "wiktionary.org",
  "baike.baidu.com",
  "zhidao.baidu.com",
  "dictionary.com",
  "merriam-webster.com",
  "translate.google.com"
];

const establishedNewsHosts = [
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "theguardian.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "cnbc.com",
  "aljazeera.com",
  "news.cn",
  "xinhuanet.com",
  "people.com.cn",
  "chinadaily.com.cn",
  "cctv.com",
  "caixin.com",
  "yicai.com"
];

export function filterResultsForPlan(results: SearchResult[], plan: AutoSearchPlan) {
  if (!plan.freshness) return results;

  const unique = new Map<string, SearchResult>();
  const ranked = results
    .filter((result) => result.snippet.trim() && !isLowQualityCurrentSource(result.url))
    .filter((result) => plan.category !== "news" || !matchesHost(result.url, nonNewsReferenceHosts))
    .sort((left, right) => scoreResult(right, plan) - scoreResult(left, plan));

  for (const result of ranked) {
    if (!unique.has(result.url)) unique.set(result.url, result);
  }

  return [...unique.values()]
    .map((result, index) => ({ ...result, sourceId: `S${index + 1}`, rank: index + 1 }));
}

function isLowQualityCurrentSource(value: string) {
  return matchesHost(value, lowQualityCurrentSourceHosts);
}

function matchesHost(value: string, hosts: string[]) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return hosts.some((candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`));
  } catch {
    return true;
  }
}

function scoreResult(result: SearchResult, plan: AutoSearchPlan) {
  let score = (result.relevanceScore ?? 0) * 100 - result.rank;
  if (plan.category === "news") {
    if (matchesHost(result.url, establishedNewsHosts)) score += 20;
    if (result.rawContent) score += 8;
    const publishedAt = result.publishedAt ? Date.parse(result.publishedAt) : Number.NaN;
    if (Number.isFinite(publishedAt)) {
      const ageHours = Math.max(0, (Date.now() - publishedAt) / 3_600_000);
      if (ageHours <= 36) score += 25;
      else if (ageHours <= 24 * 7) score += 10;
      else score -= 20;
    } else {
      score -= 8;
    }
  }
  return score;
}
