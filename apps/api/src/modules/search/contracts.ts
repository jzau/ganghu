export type SearchMode = "off" | "explicit" | "auto";

export interface SearchRequest {
  query: string;
  maxResults: number;
  language?: string;
  freshness?: "day" | "week" | "month" | "year";
  topic?: "general" | "news" | "finance";
  searchDepth?: "advanced" | "basic" | "fast" | "ultra-fast";
  includeRawContent?: boolean | "markdown" | "text";
  chunksPerSource?: 1 | 2 | 3;
}

export interface SearchResult {
  sourceId: string;
  title: string;
  url: string;
  snippet: string;
  rawContent?: string;
  publishedAt?: string;
  relevanceScore?: number;
  provider: string;
  rank: number;
}

export interface SearchProviderResponse {
  results: SearchResult[];
  requestId?: string;
  cost?: string;
}

export interface SearchProvider {
  readonly id: string;
  search(request: SearchRequest, signal: AbortSignal): Promise<SearchProviderResponse>;
}

export interface SearchGatewayContext {
  signal: AbortSignal;
  deadline: number;
}

export interface SearchExecution extends SearchProviderResponse {
  provider: string;
  durationMs: number;
  fallbackUsed: boolean;
}
