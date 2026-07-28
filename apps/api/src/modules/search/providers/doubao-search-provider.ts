import type { SearchProvider, SearchProviderResponse, SearchRequest } from "../contracts.js";
import { SearchError } from "../search-error.js";

interface DoubaoSearchPayload {
  ResponseMetadata?: {
    RequestId?: unknown;
    Error?: {
      CodeN?: unknown;
      Code?: unknown;
      Message?: unknown;
    };
  };
  Result?: {
    LogId?: unknown;
    WebResults?: Array<{
      SortId?: unknown;
      Title?: unknown;
      Url?: unknown;
      Snippet?: unknown;
      Summary?: unknown;
      Content?: unknown;
      PublishTime?: unknown;
      RankScore?: unknown;
    }>;
  };
}

const freshnessMap: Record<NonNullable<SearchRequest["freshness"]>, string> = {
  day: "OneDay",
  week: "OneWeek",
  month: "OneMonth",
  year: "OneYear"
};

export class DoubaoSearchProvider implements SearchProvider {
  readonly id = "doubao-search";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  async search(request: SearchRequest, signal: AbortSignal): Promise<SearchProviderResponse> {
    if (!this.apiKey) throw new SearchError("not_configured", "Doubao Search is not configured", false);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/search_api/web_search`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          Query: truncateQuery(request.query),
          SearchType: "web",
          Count: Math.min(Math.max(request.maxResults, 1), 50),
          Filter: {
            NeedContent: Boolean(request.includeRawContent),
            NeedUrl: true,
            ...(request.includeDomains?.length ? {
              Sites: request.includeDomains.slice(0, 20).join("|")
            } : {})
          },
          ...(request.freshness ? { TimeRange: freshnessMap[request.freshness] } : {}),
          ...(request.includeRawContent ? {
            ContentFormats: request.includeRawContent === "markdown" ? "markdown" : "text"
          } : {}),
          ...(request.topic === "finance" ? { Industry: "finance" } : {})
        })
      });
    } catch (error) {
      if (signal.aborted) throw new SearchError("cancelled", "Search was cancelled", false);
      throw new SearchError("unavailable", error instanceof Error ? error.message : "Doubao Search is unavailable", true);
    }

    const payload = await readPayload(response);
    const providerError = payload.ResponseMetadata?.Error;
    if (!response.ok || providerError) {
      const message = readProviderMessage(payload, response.status);
      const code = readProviderErrorCode(payload);
      if (response.status === 401 || response.status === 403 || isAuthenticationCode(code)) {
        throw new SearchError("authentication", message, false, response.status);
      }
      if (response.status === 429 || isRateLimitCode(code)) {
        throw new SearchError("rate_limited", message, true, response.status);
      }
      if (response.status >= 500 || isUnavailableCode(code)) {
        throw new SearchError("unavailable", message, true, response.status);
      }
      throw new SearchError("invalid_request", message, false, response.status);
    }

    const results = Array.isArray(payload.Result?.WebResults) ? payload.Result.WebResults : [];
    return {
      requestId: typeof payload.ResponseMetadata?.RequestId === "string"
        ? payload.ResponseMetadata.RequestId
        : typeof payload.Result?.LogId === "string" ? payload.Result.LogId : undefined,
      results: results.flatMap((result, index) => {
        if (typeof result.Url !== "string") return [];
        const content = typeof result.Content === "string" ? result.Content : undefined;
        const snippet = typeof result.Summary === "string"
          ? result.Summary
          : typeof result.Snippet === "string" ? result.Snippet : content ?? "";
        return [{
          sourceId: `S${index + 1}`,
          title: typeof result.Title === "string" ? result.Title : "Untitled source",
          url: result.Url,
          snippet,
          rawContent: request.includeRawContent ? content : undefined,
          publishedAt: typeof result.PublishTime === "string" ? result.PublishTime : undefined,
          relevanceScore: typeof result.RankScore === "number" ? result.RankScore : undefined,
          provider: this.id,
          rank: typeof result.SortId === "number" ? result.SortId : index + 1
        }];
      })
    };
  }
}

function truncateQuery(query: string) {
  return Array.from(query.trim()).slice(0, 100).join("");
}

async function readPayload(response: Response): Promise<DoubaoSearchPayload> {
  try {
    return await response.json() as DoubaoSearchPayload;
  } catch {
    return {};
  }
}

function readProviderErrorCode(payload: DoubaoSearchPayload) {
  const error = payload.ResponseMetadata?.Error;
  const code = error?.Code ?? error?.CodeN;
  return typeof code === "string" || typeof code === "number" ? String(code) : "";
}

function readProviderMessage(payload: DoubaoSearchPayload, status: number) {
  const code = readProviderErrorCode(payload);
  const rawMessage = payload.ResponseMetadata?.Error?.Message;
  const message = typeof rawMessage === "string" ? rawMessage : "";
  return [code, message].filter(Boolean).join(": ").slice(0, 500)
    || `Search provider returned status ${status}`;
}

function isAuthenticationCode(code: string) {
  return /^(10401|10403|700901)$|accessdenied|unauthorized|invalid.*(?:token|key|account)|signature/i.test(code);
}

function isRateLimitCode(code: string) {
  return /^700429$|ratelimit|flowlimit|throttl|requestlimit/i.test(code);
}

function isUnavailableCode(code: string) {
  return /^(10500|10501)$|innererror/i.test(code);
}
