import type { SearchProvider, SearchProviderResponse, SearchRequest } from "../contracts.js";
import { SearchError } from "../search-error.js";

interface BaiduQianfanPayload {
  request_id?: unknown;
  requestId?: unknown;
  code?: unknown;
  message?: unknown;
  references?: Array<{
    title?: unknown;
    url?: unknown;
    snippet?: unknown;
    content?: unknown;
    date?: unknown;
    type?: unknown;
    rerank_score?: unknown;
  }>;
}

const freshnessMap: Record<NonNullable<SearchRequest["freshness"]>, string> = {
  day: "week",
  week: "week",
  month: "month",
  year: "year"
};

export class BaiduQianfanProvider implements SearchProvider {
  readonly id = "baidu-qianfan";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string
  ) {}

  async search(request: SearchRequest, signal: AbortSignal): Promise<SearchProviderResponse> {
    if (!this.apiKey) throw new SearchError("not_configured", "Baidu Qianfan search is not configured", false);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v2/ai_search/web_search`, {
        method: "POST",
        signal,
        headers: {
          "X-Appbuilder-Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: truncateWeighted(request.query, 72) }],
          search_source: "baidu_search_v2",
          resource_type_filter: [{ type: "web", top_k: Math.min(Math.max(request.maxResults, 1), 50) }],
          ...(request.includeDomains?.length ? {
            search_filter: { match: { site: request.includeDomains.slice(0, 100) } }
          } : {}),
          ...(request.freshness ? { search_recency_filter: freshnessMap[request.freshness] } : {}),
          ...(request.topic === "news" ? { sort: { priority: "auto" } } : {})
        })
      });
    } catch (error) {
      if (signal.aborted) throw new SearchError("cancelled", "Search was cancelled", false);
      throw new SearchError("unavailable", error instanceof Error ? error.message : "Baidu Qianfan is unavailable", true);
    }

    const payload = await readPayload(response);
    if (!response.ok || payload.code) {
      const message = readProviderMessage(payload, response.status);
      if (response.status === 401 || response.status === 403 || isAuthenticationCode(payload.code)) {
        throw new SearchError("authentication", message, false, response.status);
      }
      if (response.status === 429) throw new SearchError("rate_limited", message, true, response.status);
      if (response.status >= 500) throw new SearchError("unavailable", message, true, response.status);
      throw new SearchError("invalid_request", message, false, response.status);
    }

    const references = Array.isArray(payload.references) ? payload.references : [];
    return {
      requestId: typeof payload.request_id === "string"
        ? payload.request_id
        : typeof payload.requestId === "string" ? payload.requestId : undefined,
      results: references.flatMap((reference, index) => {
        if (reference.type !== undefined && reference.type !== "web") return [];
        if (typeof reference.url !== "string") return [];
        const content = typeof reference.content === "string" ? reference.content : undefined;
        return [{
          sourceId: `S${index + 1}`,
          title: typeof reference.title === "string" ? reference.title : "Untitled source",
          url: reference.url,
          snippet: typeof reference.snippet === "string" ? reference.snippet : content ?? "",
          rawContent: request.includeRawContent ? content : undefined,
          publishedAt: typeof reference.date === "string" ? reference.date : undefined,
          relevanceScore: typeof reference.rerank_score === "number" ? reference.rerank_score : undefined,
          provider: this.id,
          rank: index + 1
        }];
      })
    };
  }
}

function truncateWeighted(value: string, maxWeight: number) {
  let weight = 0;
  let output = "";
  for (const character of value.trim()) {
    const nextWeight = character.codePointAt(0)! <= 0xff ? 1 : 2;
    if (weight + nextWeight > maxWeight) break;
    output += character;
    weight += nextWeight;
  }
  return output;
}

async function readPayload(response: Response): Promise<BaiduQianfanPayload> {
  try {
    return await response.json() as BaiduQianfanPayload;
  } catch {
    return {};
  }
}

function readProviderMessage(payload: BaiduQianfanPayload, status: number) {
  const code = typeof payload.code === "string" || typeof payload.code === "number" ? String(payload.code) : "";
  const message = typeof payload.message === "string" ? payload.message : "";
  return [code, message].filter(Boolean).join(": ").slice(0, 500) || `Search provider returned status ${status}`;
}

function isAuthenticationCode(code: unknown) {
  return String(code ?? "") === "216003";
}
