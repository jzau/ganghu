export type SearchErrorCode = "not_configured" | "authentication" | "invalid_request" | "rate_limited" | "timeout" | "unavailable" | "cancelled" | "unknown";

export class SearchError extends Error {
  constructor(
    readonly code: SearchErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(message);
    this.name = "SearchError";
  }
}

