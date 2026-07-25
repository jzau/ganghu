import { env } from "../lib/env.js";
import type { SearchExecution, SearchProvider } from "../modules/search/contracts.js";
import { AliyunIqsProvider } from "../modules/search/providers/aliyun-iqs-provider.js";
import { TavilyProvider } from "../modules/search/providers/tavily-provider.js";
import { SearchGateway } from "../modules/search/search-gateway.js";

const queries = process.argv.slice(2).map((query) => query.trim()).filter(Boolean);
if (!queries.length) {
  console.error('Usage: npm run search:compare -- "query one" "query two"');
  process.exit(1);
}
if (!env.TAVILY_API_KEY || !env.ALIYUN_IQS_API_KEY) {
  console.error("Both TAVILY_API_KEY and ALIYUN_IQS_API_KEY are required.");
  process.exit(1);
}

const providers: SearchProvider[] = [
  new TavilyProvider(env.TAVILY_API_KEY, env.TAVILY_BASE_URL),
  new AliyunIqsProvider(env.ALIYUN_IQS_API_KEY, env.ALIYUN_IQS_BASE_URL, env.ALIYUN_IQS_ENGINE_TYPE)
];

interface Comparison {
  query: string;
  executions: Array<SearchExecution | { provider: string; error: string }>;
  exactUrlOverlap: number;
}

const comparisons: Comparison[] = [];
for (const query of queries) {
  const executions = await Promise.all(providers.map(async (provider) => {
    const gateway = new SearchGateway(provider, env.SEARCH_TIMEOUT_MS);
    try {
      return await gateway.search({
        query,
        maxResults: env.SEARCH_MAX_RESULTS,
        searchDepth: "basic"
      }, {
        signal: new AbortController().signal,
        deadline: Date.now() + env.SEARCH_TIMEOUT_MS
      });
    } catch (error) {
      return {
        provider: provider.id,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }));

  const successful = executions.filter((execution): execution is SearchExecution => "results" in execution);
  const urlSets = successful.map((execution) => new Set(execution.results.map((result) => result.url)));
  const exactUrlOverlap = urlSets.length === 2
    ? [...urlSets[0]].filter((url) => urlSets[1].has(url)).length
    : 0;
  comparisons.push({ query, executions, exactUrlOverlap });
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  settings: {
    maxResults: env.SEARCH_MAX_RESULTS,
    timeoutMs: env.SEARCH_TIMEOUT_MS,
    aliyunEngineType: env.ALIYUN_IQS_ENGINE_TYPE
  },
  comparisons
}, null, 2));
