import { env } from "../../lib/env.js";
import type { SearchExecution, SearchMode, SearchRequest, SearchResult } from "./contracts.js";
import { AliyunIqsProvider } from "./providers/aliyun-iqs-provider.js";
import { TavilyProvider } from "./providers/tavily-provider.js";
import { SearchGateway } from "./search-gateway.js";
import { getActiveSearchProviderId, getSearchProviderAvailability } from "./search-settings.js";

const providers = {
  tavily: new TavilyProvider(env.TAVILY_API_KEY, env.TAVILY_BASE_URL),
  "aliyun-iqs": new AliyunIqsProvider(env.ALIYUN_IQS_API_KEY, env.ALIYUN_IQS_BASE_URL, env.ALIYUN_IQS_ENGINE_TYPE)
};
const gateways = {
  tavily: new SearchGateway(providers.tavily, env.SEARCH_TIMEOUT_MS),
  "aliyun-iqs": new SearchGateway(providers["aliyun-iqs"], env.SEARCH_TIMEOUT_MS)
};

export async function isPlatformSearchConfigured() {
  const provider = await getActiveSearchProviderId();
  return getSearchProviderAvailability()[provider];
}

export function resolveSearchMode(input: { searchMode?: SearchMode }): SearchMode {
  return input.searchMode ?? "auto";
}

export type SearchCategory = "weather" | "news" | "price" | "sports" | "research" | "general";

export interface AutoSearchPlan {
  needsSearch: boolean;
  query?: string;
  queries?: string[];
  freshness?: SearchRequest["freshness"];
  category?: SearchCategory;
  intent?: "general_knowledge" | "current_fact" | "news_digest" | "news_lookup" | "weather" | "price" | "sports" | "web_research";
  topic?: SearchRequest["topic"];
  region?: string;
  entities?: string[];
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
const currentEventQuestionPattern =
  /(?:[\p{Script=Han}A-Za-z0-9·.&_-]{2,40})(?:怎么了|咋了|发生了什么|发生啥了?|出什么事了?|出啥事了?|为何被|为什么被)|\b(?:what happened to|what(?:'s| is) going on with)\s+[\p{L}\p{N}]/iu;
const broadNewsScopePattern =
  /^(?:中国|国内|国际|全球|世界|亚洲|欧洲|北美|南美|非洲|澳洲|澳大利亚|美国|英国|加拿大|日本|韩国|印度|新加坡|香港|台湾|本地)$/iu;
const comparisonIntentPattern =
  /区别|差别|不同之处|对比|比较|哪个好|哪个更好|优缺点|\b(?:vs\.?|versus|differences?|difference between|compare|comparison|which is better)\b/iu;

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
  const researchEntities = extractResearchEntities(contextText);
  const explicitlyRequested = explicitSearchPattern.test(message);
  const isFresh = freshnessPattern.test(message) || currentRolePattern.test(message) || versionPattern.test(message);
  const currentWeather = category === "weather" && !weatherExplanationPattern.test(message);
  const currentEventLookup = currentEventQuestionPattern.test(message);
  const specificNewsSubject = extractSpecificNewsSubject(contextText);
  const broadNews = effectiveBroadNews(contextText, category, currentEventLookup, specificNewsSubject);
  const currentVertical = category === "news" || category === "price" || category === "sports" || currentEventLookup || Boolean(specificNewsSubject);
  const needsResearch = researchEntities.length > 0;
  const needsSearch = explicitlyRequested || isFresh || currentWeather || currentVertical || needsResearch;

  if (!needsSearch) return { needsSearch: false, reason: "no_search_needed" };

  const effectiveCategory: SearchCategory = needsResearch
    ? "research"
    : currentEventLookup || specificNewsSubject ? "news" : category;
  const queries = needsResearch
    ? buildResearchQueries(contextText, researchEntities)
    : currentEventLookup || specificNewsSubject
      ? buildCurrentEventQueries(specificNewsSubject ?? contextText)
      : buildSearchQueries(contextText, effectiveCategory);
  const specificCurrentLookup = currentEventLookup || Boolean(specificNewsSubject);
  return {
    needsSearch: true,
    query: queries[0],
    queries,
    freshness: needsResearch
      ? "year"
      : specificCurrentLookup
      ? (/\b(?:today|tonight)\b|今天|今日|今晚/iu.test(message) ? "day" : "week")
      : selectFreshness(effectiveCategory, message),
    category: effectiveCategory,
    ...(needsResearch
      ? { intent: "web_research" as const }
      : specificCurrentLookup || effectiveCategory === "news"
      ? { intent: specificCurrentLookup ? "news_lookup" as const : broadNews ? "news_digest" as const : "news_lookup" as const }
      : {}),
    ...(effectiveCategory === "news" ? { topic: "news" as const } : needsResearch ? { topic: "general" as const } : {}),
    ...(researchEntities.length ? { entities: researchEntities } : {}),
    ...(broadNews ? { responseStyle: "news_digest" as const } : needsResearch ? { responseStyle: "detailed" as const } : {}),
    reason: explicitlyRequested ? "explicit_request" : "fresh_information"
  };
}

function effectiveBroadNews(
  message: string,
  category: SearchCategory,
  currentEventLookup: boolean,
  specificNewsSubject: string | undefined
) {
  return !currentEventLookup && !specificNewsSubject && category === "news" && broadNewsPattern.test(message);
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

  const providerId = await getActiveSearchProviderId();
  const gateway = gateways[providerId];
  const startedAt = Date.now();
  const initialRequests = buildSearchRequests(input.plan, input.maxResults);
  const attempts = await executeSearchRequests(initialRequests, input, gateway);
  const executions = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
  if (!executions.length) {
    const failure = attempts.find((attempt) => attempt.status === "rejected");
    throw failure && failure.status === "rejected" ? failure.reason : new Error("Search returned no executions");
  }

  const resultLimit = input.plan.category === "news" || input.plan.category === "research"
    ? Math.min(Math.max(input.maxResults ?? env.SEARCH_MAX_RESULTS, 1) + 3, 8)
    : Math.min(Math.max(input.maxResults ?? env.SEARCH_MAX_RESULTS, 1), 8);
  let allExecutions = executions;
  let executedRequests = [...initialRequests];
  let combinedResults = executions.flatMap((execution) => execution.results);
  let filteredResults = filterResultsForPlan(combinedResults, input.plan);
  let retryUsed = false;

  if (
    shouldRetrySearch(filteredResults, input.plan) &&
    input.deadline - Date.now() > Math.max(env.SEARCH_TIMEOUT_MS, 1_500)
  ) {
    const recoveryRequests = buildRecoverySearchRequests(input.plan, input.maxResults);
    if (recoveryRequests.length) {
      const recoveryAttempts = await executeSearchRequests(recoveryRequests, input, gateway);
      const recoveryExecutions = recoveryAttempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
      if (recoveryExecutions.length) {
        retryUsed = true;
        executedRequests = [...executedRequests, ...recoveryRequests];
        allExecutions = [...allExecutions, ...recoveryExecutions];
        combinedResults = [...combinedResults, ...recoveryExecutions.flatMap((execution) => execution.results)];
        filteredResults = filterResultsForPlan(combinedResults, input.plan);
      }
    }
  }

  if (
    input.plan.category === "research" &&
    input.deadline - Date.now() > Math.max(env.SEARCH_TIMEOUT_MS, 1_500)
  ) {
    const missingEntities = findMissingResearchEntities(filteredResults, input.plan.entities ?? []);
    const recoveryRequests = buildResearchRecoveryRequests(missingEntities, input.plan, input.maxResults);
    if (recoveryRequests.length) {
      const recoveryAttempts = await executeSearchRequests(recoveryRequests, input, gateway);
      const recoveryExecutions = recoveryAttempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
      if (recoveryExecutions.length) {
        retryUsed = true;
        executedRequests = [...executedRequests, ...recoveryRequests];
        allExecutions = [...allExecutions, ...recoveryExecutions];
        combinedResults = [...combinedResults, ...recoveryExecutions.flatMap((execution) => execution.results)];
        filteredResults = filterResultsForPlan(combinedResults, input.plan);
      }
    }
  }

  return {
    results: filteredResults.slice(0, resultLimit),
    provider: allExecutions[0].provider,
    durationMs: Date.now() - startedAt,
    fallbackUsed: allExecutions.some((execution) => execution.fallbackUsed),
    retryUsed,
    queries: executedRequests.map((request) => request.query),
    requestId: allExecutions.map((execution) => execution.requestId).filter(Boolean).join(",") || undefined,
    cost: sumSearchCosts(allExecutions.map((execution) => execution.cost))
  };
}

function executeSearchRequests(
  requests: SearchRequest[],
  input: { signal: AbortSignal; deadline: number },
  gateway: SearchGateway
) {
  return Promise.allSettled(
    requests.map((request) => gateway.search(request, { signal: input.signal, deadline: input.deadline }))
  );
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

function buildCurrentEventQueries(message: string) {
  const subject = extractSearchSubject(message);
  const date = new Date().toISOString().slice(0, 10);
  if (/\p{Script=Han}/u.test(message)) {
    return [
      `${subject} 最新消息 ${date}`,
      `${subject} 发生了什么 官方回应 ${date}`,
      `${subject} 最新报道`
    ];
  }
  return [
    `${subject} latest news ${date}`,
    `what happened to ${subject} official response ${date}`,
    `${subject} latest developments`
  ];
}

function buildResearchQueries(message: string, entities: string[]) {
  if (entities.length >= 2) {
    const [left, right] = entities;
    return [
      `"${left}" "${right}" comparison`,
      `"${left}" official GitHub README documentation`,
      `"${right}" official GitHub README documentation`
    ];
  }
  const [entity] = entities;
  return [
    `"${entity}" official GitHub README`,
    `"${entity}" official documentation features architecture`,
    message
  ];
}

function extractSpecificNewsSubject(message: string) {
  if (!newsPattern.test(message)) return undefined;
  const subject = message
    .replace(/今天|今日|今晚|最新|近期|最近|实时/giu, " ")
    .replace(/新闻|头条|要闻|快讯|消息|动态|报道/giu, " ")
    .replace(/\b(?:today|tonight|latest|recent|breaking|live|news|headlines?|updates?|reports?)\b/giu, " ")
    .replace(/[?？!！"'“”‘’()[\]{}:：,，.。/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (subject.length < 2 || subject.length > 60 || broadNewsScopePattern.test(subject)) return undefined;
  return subject;
}

function buildSearchQuery(message: string, category: SearchCategory) {
  if (category === "weather") return `${message} official weather forecast`;
  if (category === "price") return `${message} current market data`;
  if (category === "sports") return `${message} official score or schedule`;
  return message;
}

export function buildSearchRequests(plan: AutoSearchPlan, maxResults = env.SEARCH_MAX_RESULTS): SearchRequest[] {
  const queries = plan.queries?.length ? plan.queries : plan.query ? [plan.query] : [];
  const boundedMaxResults = Math.min(Math.max(maxResults, 1), plan.category === "news" || plan.category === "research" ? 5 : 8);
  const detailedNewsLookup = plan.category === "news" && plan.intent !== "news_digest" && plan.responseStyle !== "news_digest";
  return queries.slice(0, 4).map((query) => {
    const matchingResearchEntities = (plan.entities ?? []).filter((entity) =>
      query.toLocaleLowerCase().includes(entity.toLocaleLowerCase())
    );
    return {
    query: query.trim().slice(0, 400),
    maxResults: boundedMaxResults,
    freshness: plan.freshness,
    ...(plan.category === "news" ? {
      topic: "news" as const,
      searchDepth: detailedNewsLookup ? "advanced" as const : "basic" as const,
      ...(detailedNewsLookup ? { chunksPerSource: 3 as const } : {}),
      includeRawContent: "markdown" as const
    } : plan.category === "research" ? {
      topic: "general" as const,
      searchDepth: "advanced" as const,
      chunksPerSource: 3 as const,
      includeRawContent: "markdown" as const,
      ...(matchingResearchEntities.length === 1 ? { exactMatch: true } : {}),
      ...(/\bGitHub\b/i.test(query) ? { includeDomains: ["github.com"] } : {})
    } : {})
  };
  });
}

function buildRecoverySearchRequests(plan: AutoSearchPlan, maxResults = env.SEARCH_MAX_RESULTS): SearchRequest[] {
  if (plan.category !== "news") return [];
  const subject = extractSearchSubject(plan.query ?? plan.queries?.[0] ?? "");
  if (!subject) return [];
  const date = new Date().toISOString().slice(0, 10);
  const queries = /\p{Script=Han}/u.test(subject)
    ? [`${subject} 最新进展 官方通报 ${date}`, `"${subject}" 今日 事件`]
    : [`${subject} latest update official statement ${date}`, `"${subject}" breaking news today`];
  const existing = new Set(plan.queries ?? (plan.query ? [plan.query] : []));
  return queries
    .filter((query) => !existing.has(query))
    .slice(0, 2)
    .map((query) => ({
      query,
      maxResults: Math.min(Math.max(maxResults, 1), 5),
      freshness: plan.freshness,
      topic: "general" as const,
      searchDepth: "advanced" as const,
      chunksPerSource: 3 as const,
      includeRawContent: "markdown" as const
    }));
}

function buildResearchRecoveryRequests(
  entities: string[],
  plan: AutoSearchPlan,
  maxResults = env.SEARCH_MAX_RESULTS
): SearchRequest[] {
  return entities.slice(0, 2).flatMap((entity) => [{
    query: `"${entity}" open source official repository`,
    maxResults: Math.min(Math.max(maxResults, 1), 5),
    freshness: plan.freshness,
    topic: "general" as const,
    searchDepth: "basic" as const,
    includeRawContent: "markdown" as const,
    exactMatch: true,
    includeDomains: ["github.com"]
  }, {
    query: `"${entity}" official website software`,
    maxResults: Math.min(Math.max(maxResults, 1), 5),
    freshness: plan.freshness,
    topic: "general" as const,
    searchDepth: "basic" as const,
    includeRawContent: "markdown" as const,
    exactMatch: true
  }]);
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

const nonCurrentNewsTitlePattern =
  /历史数据|历史行情|走势图|百科|词典|官网首页|\bhistorical data\b|\bstock (?:quote|chart|history)\b|\bdictionary\b|\bencyclopedia\b/iu;

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
  "yicai.com",
  "ifeng.com",
  "guancha.cn",
  "samr.gov.cn",
  "gov.cn"
];

export function filterResultsForPlan(results: SearchResult[], plan: AutoSearchPlan) {
  if (!plan.freshness) return results;

  const subjectTerms = plan.category === "news" && plan.intent !== "news_digest"
    ? extractDistinctiveTerms(plan.query ?? plan.queries?.[0] ?? "")
    : plan.category === "research" ? plan.entities ?? [] : [];
  const unique = new Map<string, SearchResult>();
  const ranked = results
    .filter((result) => result.snippet.trim() && !isLowQualityCurrentSource(result.url))
    .filter((result) => plan.category !== "news" || !matchesHost(result.url, nonNewsReferenceHosts))
    .filter((result) => plan.category !== "news" || !nonCurrentNewsTitlePattern.test(result.title))
    .filter((result) => plan.category !== "news" || isFreshEnough(result, plan.freshness!))
    .filter((result) => result.relevanceScore === undefined || result.relevanceScore >= 0.35)
    .filter((result) => subjectTerms.length === 0 || resultContainsAnyTerm(result, subjectTerms))
    .sort((left, right) => scoreResult(right, plan) - scoreResult(left, plan));

  for (const result of ranked) {
    if (!unique.has(result.url)) unique.set(result.url, result);
  }

  const ordered = plan.category === "research"
    ? prioritizeEntityCoverage([...unique.values()], plan.entities ?? [])
    : [...unique.values()];
  return ordered
    .map((result, index) => ({ ...result, sourceId: `S${index + 1}`, rank: index + 1 }));
}

export function shouldRetrySearch(results: SearchResult[], plan: AutoSearchPlan) {
  if (plan.category !== "news" || plan.intent === "news_digest") return false;
  if (results.length < 2) return true;
  const strongResults = results.filter((result) =>
    (result.relevanceScore ?? 0.5) >= 0.55 &&
    isFreshEnough(result, plan.freshness ?? "week")
  );
  return strongResults.length < 1;
}

function findMissingResearchEntities(results: SearchResult[], entities: string[]) {
  return entities.filter((entity) =>
    !results.some((result) => officialEntitySourceScore(result, [entity]) >= 40)
  );
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
    const publishedAt = parseResultDate(result);
    if (publishedAt !== undefined) {
      const ageHours = Math.max(0, (Date.now() - publishedAt) / 3_600_000);
      if (ageHours <= 36) score += 25;
      else if (ageHours <= 24 * 7) score += 10;
      else score -= 20;
    } else {
      score -= 8;
    }
  }
  if (plan.category === "research") {
    if (matchesHost(result.url, ["github.com"])) score += 20;
    if (result.rawContent) score += 8;
    const entityMatches = (plan.entities ?? []).filter((entity) => resultContainsAnyTerm(result, [entity])).length;
    score += entityMatches * 12;
    score += officialEntitySourceScore(result, plan.entities ?? []);
  }
  return score;
}

function officialEntitySourceScore(result: SearchResult, entities: string[]) {
  try {
    const url = new URL(result.url);
    const hostname = url.hostname.toLocaleLowerCase().replace(/^www\./, "");
    const segments = url.pathname.split("/").filter(Boolean).map((segment) => normalizeEntityName(segment));
    let score = 0;
    for (const entity of entities) {
      const normalized = normalizeEntityName(entity);
      if (hostname === `${normalized}.com` || hostname === `${normalized}.org` || hostname === `${normalized}.ai`) score += 45;
      if (hostname === "github.com" && segments[1] === normalized) score += 45;
      if (normalizeEntityName(result.title).startsWith(normalized)) score += 10;
    }
    return score;
  } catch {
    return 0;
  }
}

function normalizeEntityName(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function prioritizeEntityCoverage(results: SearchResult[], entities: string[]) {
  if (entities.length < 2) return results;
  const selected: SearchResult[] = [];
  const used = new Set<string>();
  for (const entity of entities) {
    const match = results.find((result) => !used.has(result.url) && resultContainsAnyTerm(result, [entity]));
    if (match) {
      selected.push(match);
      used.add(match.url);
    }
  }
  return [...selected, ...results.filter((result) => !used.has(result.url))];
}

function isFreshEnough(result: SearchResult, freshness: NonNullable<AutoSearchPlan["freshness"]>) {
  const publishedAt = parseResultDate(result);
  if (publishedAt === undefined) return true;
  const ageMs = Date.now() - publishedAt;
  if (ageMs < -36 * 3_600_000) return false;
  const maximumAgeMs = {
    day: 3 * 24 * 3_600_000,
    week: 10 * 24 * 3_600_000,
    month: 45 * 24 * 3_600_000,
    year: 400 * 24 * 3_600_000
  }[freshness];
  return ageMs <= maximumAgeMs;
}

function parseResultDate(result: SearchResult) {
  if (result.publishedAt) {
    const parsed = Date.parse(result.publishedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  const text = `${result.title} ${result.snippet.slice(0, 240)}`;
  const fullDate = text.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\b/);
  if (fullDate) {
    const parsed = Date.UTC(Number(fullDate[1]), Number(fullDate[2]) - 1, Number(fullDate[3]));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function resultContainsAnyTerm(result: SearchResult, terms: string[]) {
  const evidence = `${result.title} ${result.snippet} ${result.rawContent ?? ""}`.toLocaleLowerCase();
  return terms.some((term) => evidence.includes(term.toLocaleLowerCase()));
}

function extractDistinctiveTerms(query: string) {
  const cleaned = query
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ")
    .replace(/今天|今日|最新|消息|新闻|报道|发生了什么|发生|怎么了|官方回应|官方通报|最新进展|事件/gu, " ")
    .replace(/\b(?:today|latest|news|breaking|update|developments?|official|response|statement|what|happened|to)\b/giu, " ")
    .replace(/[?？!！"'“”‘’()[\]{}:：,，.。/\\_-]+/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && term.length <= 40);
  return [...new Set(cleaned)].slice(0, 6);
}

function extractSearchSubject(message: string) {
  return extractDistinctiveTerms(message)[0] ?? message.trim().slice(0, 80);
}

function extractResearchEntities(message: string) {
  if (!comparisonIntentPattern.test(message) && !looksLikeNamedEntityLookup(message)) return [];

  const latinNames = message.match(/[A-Za-z][A-Za-z0-9._+-]{1,60}/g) ?? [];
  const stopWords = new Set([
    "and", "or", "vs", "versus", "what", "is", "the", "difference", "between",
    "compare", "comparison", "which", "better", "tell", "me", "about", "github"
  ]);
  const entities = latinNames
    .filter((name) => !stopWords.has(name.toLocaleLowerCase()))
    .filter((name) => name.length >= 3);
  return [...new Set(entities.map((entity) => entity.trim()))].slice(0, comparisonIntentPattern.test(message) ? 2 : 1);
}

function looksLikeNamedEntityLookup(message: string) {
  return /是什么|是做什么的|介绍一下|怎么使用|怎么用|\b(?:what is|what does|tell me about|how to use)\b/iu.test(message);
}
