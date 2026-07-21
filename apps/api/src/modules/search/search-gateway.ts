import type { SearchExecution, SearchGatewayContext, SearchProvider, SearchRequest } from "./contracts.js";
import { normalizeAndDeduplicateResults } from "./result-normalizer.js";
import { SearchError } from "./search-error.js";

export class SearchGateway {
  constructor(
    private readonly primary: SearchProvider,
    private readonly timeoutMs: number
  ) {}

  async search(request: SearchRequest, context: SearchGatewayContext): Promise<SearchExecution> {
    const startedAt = Date.now();
    const remainingMs = context.deadline - startedAt;
    if (remainingMs <= 0) throw new SearchError("timeout", "Search deadline exceeded", true);

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), Math.min(this.timeoutMs, remainingMs));
    const signal = AbortSignal.any([context.signal, timeoutController.signal]);

    try {
      const response = await this.primary.search(request, signal);
      return {
        ...response,
        results: normalizeAndDeduplicateResults(response.results, request.maxResults),
        provider: this.primary.id,
        durationMs: Date.now() - startedAt,
        fallbackUsed: false
      };
    } catch (error) {
      if (context.signal.aborted) throw new SearchError("cancelled", "Search was cancelled", false);
      if (timeoutController.signal.aborted) throw new SearchError("timeout", "Search provider timed out", true);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

