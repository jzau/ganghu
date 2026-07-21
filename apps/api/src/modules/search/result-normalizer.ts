import type { SearchResult } from "./contracts.js";

const trackingParameters = new Set(["fbclid", "gclid", "mc_cid", "mc_eid"]);

export function normalizeAndDeduplicateResults(results: SearchResult[], maxResults: number) {
  const unique = new Map<string, SearchResult>();

  for (const result of results) {
    const url = canonicalizeHttpUrl(result.url);
    if (!url || unique.has(url)) continue;

    unique.set(url, {
      ...result,
      sourceId: `S${unique.size + 1}`,
      title: sanitizeText(result.title, 300) || new URL(url).hostname,
      url,
      snippet: sanitizeText(result.snippet, 2_000),
      rank: unique.size + 1
    });
    if (unique.size >= maxResults) break;
  }

  return [...unique.values()];
}

export function canonicalizeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || trackingParameters.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return undefined;
  }
}

export function sanitizeText(value: string, maxLength: number) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

