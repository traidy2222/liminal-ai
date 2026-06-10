export interface WebSearchHit {
  url: string;
  title: string;
  snippet: string;
}

/** @deprecated Use WebSearchHit */
export type DdgHit = WebSearchHit;

export type WebSearchProviderId = "duckduckgo" | "serper";

export interface WebSearchResult {
  hits: WebSearchHit[];
  provider: WebSearchProviderId;
  fallbackFrom?: "serper";
  fallbackReason?: string;
}

export type WebSearchProviderOutcome =
  | { ok: true; hits: WebSearchHit[] }
  | { ok: false; error: string };
