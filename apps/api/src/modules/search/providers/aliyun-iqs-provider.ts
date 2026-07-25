import type { SearchProvider, SearchProviderResponse, SearchRequest } from "../contracts.js";
import { SearchError } from "../search-error.js";

export type AliyunIqsEngineType = "Generic" | "GenericAdvanced" | "LiteAdvanced";

interface AliyunIqsPayload {
  requestId?: unknown;
  pageItems?: Array<{
    title?: unknown;
    link?: unknown;
    snippet?: unknown;
    publishedTime?: unknown;
    publishedDate?: unknown;
    mainText?: unknown;
    markdownText?: unknown;
    summary?: unknown;
    rerankScore?: unknown;
  }>;
  costCredits?: {
    search?: {
      genericTextSearch?: unknown;
      liteAdvancedTextSearch?: unknown;
    };
    valueAdded?: {
      summary?: unknown;
      advanced?: unknown;
    };
  };
}

const freshnessMap: Record<NonNullable<SearchRequest["freshness"]>, string> = {
  day: "OneDay",
  week: "OneWeek",
  month: "OneMonth",
  year: "OneYear"
};

export class AliyunIqsProvider implements SearchProvider {
  readonly id = "aliyun-iqs";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly engineType: AliyunIqsEngineType = "LiteAdvanced"
  ) {}

  async search(request: SearchRequest, signal: AbortSignal): Promise<SearchProviderResponse> {
    if (!this.apiKey) throw new SearchError("not_configured", "Web search is not configured", false);

    const includeContent = Boolean(request.includeRawContent);
    const usesAdvancedParams = this.engineType === "LiteAdvanced";
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/llm`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: request.query,
          engineType: this.engineType,
          timeRange: request.freshness ? freshnessMap[request.freshness] : "NoLimit",
          contents: {
            mainText: includeContent && request.includeRawContent !== "markdown",
            markdownText: includeContent && request.includeRawContent === "markdown",
            summary: false,
            rerankScore: true
          },
          ...(usesAdvancedParams ? {
            advancedParams: {
              numResults: String(Math.min(Math.max(request.maxResults, 1), 50)),
              ...(request.includeDomains?.length ? { includeSites: request.includeDomains.join(",") } : {})
            }
          } : {})
        })
      });
    } catch (error) {
      if (signal.aborted) throw new SearchError("cancelled", "Search was cancelled", false);
      throw new SearchError("unavailable", error instanceof Error ? error.message : "Search provider is unavailable", true);
    }

    if (!response.ok) {
      const message = await readSafeError(response);
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new SearchError("authentication", message, false, response.status);
      }
      if (response.status === 429) throw new SearchError("rate_limited", message, true, response.status);
      if (response.status >= 500) throw new SearchError("unavailable", message, true, response.status);
      throw new SearchError("invalid_request", message, false, response.status);
    }

    const payload = await response.json() as AliyunIqsPayload;
    const results = Array.isArray(payload.pageItems) ? payload.pageItems : [];
    return {
      requestId: typeof payload.requestId === "string" ? payload.requestId : undefined,
      cost: totalCredits(payload.costCredits),
      results: results.flatMap((result, index) => {
        if (typeof result.link !== "string") return [];
        const rawContent = request.includeRawContent === "markdown"
          ? result.markdownText
          : request.includeRawContent ? result.mainText : undefined;
        return [{
          sourceId: `S${index + 1}`,
          title: typeof result.title === "string" ? result.title : "Untitled source",
          url: result.link,
          snippet: typeof result.summary === "string"
            ? result.summary
            : typeof result.snippet === "string" ? result.snippet : "",
          rawContent: typeof rawContent === "string" ? rawContent : undefined,
          publishedAt: typeof result.publishedTime === "string"
            ? result.publishedTime
            : typeof result.publishedDate === "string" ? result.publishedDate : undefined,
          relevanceScore: typeof result.rerankScore === "number" ? result.rerankScore : undefined,
          provider: this.id,
          rank: index + 1
        }];
      })
    };
  }
}

function totalCredits(cost: AliyunIqsPayload["costCredits"]) {
  if (!cost) return undefined;
  const values = [
    cost.search?.genericTextSearch,
    cost.search?.liteAdvancedTextSearch,
    cost.valueAdded?.summary,
    cost.valueAdded?.advanced
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? String(values.reduce((total, value) => total + value, 0)) : undefined;
}

async function readSafeError(response: Response) {
  const body = await response.text().catch(() => "");
  if (!body) return `Search provider returned status ${response.status}`;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown };
    const parts = [parsed.code, parsed.message].filter((value): value is string => typeof value === "string");
    return parts.length ? parts.join(": ").slice(0, 500) : `Search provider returned status ${response.status}`;
  } catch {
    return `Search provider returned status ${response.status}`;
  }
}
