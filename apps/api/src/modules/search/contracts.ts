export type SearchMode = "off" | "explicit" | "auto";

export interface SearchRequest {
  query: string;
  maxResults: number;
  language?: string;
  freshness?: "day" | "week" | "month" | "year";
}

export interface SearchResult {
  sourceId: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
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

