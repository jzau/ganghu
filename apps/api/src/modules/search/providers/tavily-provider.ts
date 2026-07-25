import type { SearchProvider, SearchProviderResponse, SearchRequest } from "../contracts.js";
import { SearchError } from "../search-error.js";

interface TavilyPayload {
  request_id?: unknown;
  usage?: { credits?: unknown };
  results?: Array<{
    title?: unknown;
    url?: unknown;
    content?: unknown;
    raw_content?: unknown;
    published_date?: unknown;
    score?: unknown;
  }>;
}

export class TavilyProvider implements SearchProvider {
  readonly id = "tavily";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  async search(request: SearchRequest, signal: AbortSignal): Promise<SearchProviderResponse> {
    if (!this.apiKey) throw new SearchError("not_configured", "Web search is not configured", false);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/search`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: request.query,
          search_depth: request.searchDepth ?? "fast",
          max_results: request.maxResults,
          topic: request.topic ?? "general",
          include_answer: false,
          include_raw_content: request.includeRawContent ?? false,
          include_images: false,
          include_usage: true,
          ...(request.chunksPerSource ? { chunks_per_source: request.chunksPerSource } : {}),
          ...(request.exactMatch ? { exact_match: true } : {}),
          ...(request.includeDomains?.length ? { include_domains: request.includeDomains } : {}),
          ...(request.freshness ? { time_range: request.freshness } : {})
        })
      });
    } catch (error) {
      if (signal.aborted) throw new SearchError("cancelled", "Search was cancelled", false);
      throw new SearchError("unavailable", error instanceof Error ? error.message : "Search provider is unavailable", true);
    }

    if (!response.ok) {
      const message = await readSafeError(response);
      if (response.status === 401 || response.status === 403) throw new SearchError("authentication", message, false, response.status);
      if (response.status === 429) throw new SearchError("rate_limited", message, true, response.status);
      if (response.status >= 500) throw new SearchError("unavailable", message, true, response.status);
      throw new SearchError("invalid_request", message, false, response.status);
    }

    const payload = await response.json() as TavilyPayload;
    const results = Array.isArray(payload.results) ? payload.results : [];
    return {
      requestId: typeof payload.request_id === "string" ? payload.request_id : undefined,
      cost: typeof payload.usage?.credits === "number" ? String(payload.usage.credits) : undefined,
      results: results.flatMap((result, index) => {
        if (typeof result.url !== "string") return [];
        return [{
          sourceId: `S${index + 1}`,
          title: typeof result.title === "string" ? result.title : "Untitled source",
          url: result.url,
          snippet: typeof result.content === "string" ? result.content : "",
          rawContent: typeof result.raw_content === "string" ? result.raw_content : undefined,
          publishedAt: typeof result.published_date === "string" ? result.published_date : undefined,
          relevanceScore: typeof result.score === "number" ? result.score : undefined,
          provider: this.id,
          rank: index + 1
        }];
      })
    };
  }
}

async function readSafeError(response: Response) {
  const body = await response.text().catch(() => "");
  if (!body) return `Search provider returned status ${response.status}`;
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown };
    const message = parsed.detail ?? parsed.message;
    return typeof message === "string" ? message.slice(0, 500) : `Search provider returned status ${response.status}`;
  } catch {
    return `Search provider returned status ${response.status}`;
  }
}
