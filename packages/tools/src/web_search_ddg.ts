import { fetchWithRetry } from "./network_retry.js";
import { buildWebFetchInit } from "./web_fetch_http.js";
import type { WebSearchHit, WebSearchProviderOutcome } from "./web_search_types.js";

export function normalizeTemporalQuery(query: string): string {
  const q = query.trim();
  if (q.length < 4) return q;
  const lower = q.toLowerCase();
  const isLatestIntent =
    /\blatest|news|update|current|today|this week|this month|recent|breaking|version|release|released|release notes|changelog|what's new\b/.test(
      lower
    );
  if (!isLatestIntent) return q;
  if (/\b(in|during|from)\s+20\d{2}\b/.test(lower)) return q;

  const currentYear = new Date().getFullYear();
  const years = [...q.matchAll(/\b(20\d{2})\b/g)].map((m) => parseInt(m[1]!, 10));
  if (years.length === 0) {
    return `${q} ${currentYear}`;
  }
  const maxYear = Math.max(...years);
  if (maxYear < currentYear) {
    return q.replace(/\b20\d{2}\b/g, String(currentYear));
  }
  return q;
}

export async function runHtmlDdgSearch(
  query: string,
  max: number,
  opts?: { fetchImpl?: typeof fetch }
): Promise<WebSearchProviderOutcome> {
  const q = encodeURIComponent(query);
  try {
    const url = `https://html.duckduckgo.com/html/?q=${q}`;
    const res = await fetchWithRetry(
      url,
      buildWebFetchInit("primary"),
      { timeoutMs: 15_000, fetchImpl: opts?.fetchImpl },
    );

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const html = await res.text();
    const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)/g;
    const snippetRe = /class="result__snippet"[^>]*>([^<]+)/g;

    const links: Array<{ url: string; title: string }> = [];
    const snippets: string[] = [];
    let m: RegExpExecArray | null;

    while ((m = linkRe.exec(html)) !== null && links.length < max) {
      links.push({ url: m[1]!.trim(), title: m[2]!.trim() });
    }
    while ((m = snippetRe.exec(html)) !== null && snippets.length < max) {
      snippets.push(m[1]!.trim());
    }

    if (links.length === 0) {
      return { ok: true, hits: [] };
    }

    const hits: WebSearchHit[] = links.map((l, i) => ({
      url: l.url,
      title: l.title,
      snippet: snippets[i] ?? "",
    }));
    return { ok: true, hits };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
