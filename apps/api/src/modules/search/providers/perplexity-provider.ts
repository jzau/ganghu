import type { SearchProvider, SearchProviderResponse, SearchRequest } from "../contracts.js";
import { SearchError } from "../search-error.js";

interface PerplexityPayload {
  id?: unknown;
  detail?: unknown;
  message?: unknown;
  results?: Array<{
    title?: unknown;
    url?: unknown;
    snippet?: unknown;
    date?: unknown;
    last_updated?: unknown;
  }>;
}

const contextSizeMap: Record<NonNullable<SearchRequest["searchDepth"]>, "low" | "medium" | "high"> = {
  "ultra-fast": "low",
  fast: "low",
  basic: "medium",
  advanced: "high"
};

export class PerplexityProvider implements SearchProvider {
  readonly id = "perplexity";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  async search(request: SearchRequest, signal: AbortSignal): Promise<SearchProviderResponse> {
    if (!this.apiKey) throw new SearchError("not_configured", "Perplexity search is not configured", false);

    const language = normalizeLanguage(request.language);
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
          max_results: Math.min(Math.max(request.maxResults, 1), 20),
          ...(request.searchDepth ? { search_context_size: contextSizeMap[request.searchDepth] } : {}),
          ...(language ? { search_language_filter: [language] } : {}),
          ...(request.includeDomains?.length ? {
            search_domain_filter: request.includeDomains.slice(0, 20)
          } : {}),
          ...(request.freshness ? { search_recency_filter: request.freshness } : {})
        })
      });
    } catch (error) {
      if (signal.aborted) throw new SearchError("cancelled", "Search was cancelled", false);
      throw new SearchError("unavailable", error instanceof Error ? error.message : "Perplexity is unavailable", true);
    }

    const payload = await readPayload(response);
    if (!response.ok) {
      const message = readProviderMessage(payload, response.status);
      if (response.status === 401 || response.status === 403) {
        throw new SearchError("authentication", message, false, response.status);
      }
      if (response.status === 429) throw new SearchError("rate_limited", message, true, response.status);
      if (response.status >= 500) throw new SearchError("unavailable", message, true, response.status);
      throw new SearchError("invalid_request", message, false, response.status);
    }

    const results = Array.isArray(payload.results) ? payload.results : [];
    return {
      requestId: typeof payload.id === "string" ? payload.id : undefined,
      results: results.flatMap((result, index) => {
        if (typeof result.url !== "string") return [];
        const snippet = typeof result.snippet === "string" ? result.snippet : "";
        return [{
          sourceId: `S${index + 1}`,
          title: typeof result.title === "string" ? result.title : "Untitled source",
          url: result.url,
          snippet,
          rawContent: request.includeRawContent ? snippet : undefined,
          publishedAt: typeof result.date === "string"
            ? result.date
            : typeof result.last_updated === "string" ? result.last_updated : undefined,
          provider: this.id,
          rank: index + 1
        }];
      })
    };
  }
}

async function readPayload(response: Response): Promise<PerplexityPayload> {
  try {
    return await response.json() as PerplexityPayload;
  } catch {
    return {};
  }
}

function readProviderMessage(payload: PerplexityPayload, status: number) {
  if (typeof payload.detail === "string") return payload.detail.slice(0, 500);
  if (Array.isArray(payload.detail)) {
    const details = payload.detail.flatMap((item) => {
      if (!item || typeof item !== "object" || !("msg" in item)) return [];
      return typeof item.msg === "string" ? [item.msg] : [];
    });
    if (details.length) return details.join("; ").slice(0, 500);
  }
  if (typeof payload.message === "string") return payload.message.slice(0, 500);
  return `Search provider returned status ${status}`;
}

function normalizeLanguage(language: string | undefined) {
  const code = language?.trim().toLowerCase().split(/[-_]/, 1)[0];
  return code && /^[a-z]{2}$/.test(code) ? code : undefined;
}
