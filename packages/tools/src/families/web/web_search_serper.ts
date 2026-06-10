import { effectiveHarnessEnvRaw } from "@liminal/core";
import { fetchWithRetry } from "../../shared/network_retry.js";
import type { WebSearchHit, WebSearchProviderOutcome } from "./web_search_types.js";

const SERPER_SEARCH_URL = "https://google.serper.dev/search";

export interface SerperSearchOptions {
  apiKey?: string;
  gl?: string;
  hl?: string;
}

function resolveSerperApiKey(override?: string): string {
  const key = (override ?? effectiveHarnessEnvRaw("AGENT_SERPER_API_KEY") ?? "").trim();
  return key;
}

export function mapSerperOrganic(
  organic: unknown,
  max: number
): WebSearchHit[] {
  if (!Array.isArray(organic)) return [];
  const hits: WebSearchHit[] = [];
  for (const row of organic) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const url = String(o["link"] ?? o["url"] ?? "").trim();
    if (!url) continue;
    hits.push({
      url,
      title: String(o["title"] ?? "").trim(),
      snippet: String(o["snippet"] ?? "").trim(),
    });
    if (hits.length >= max) break;
  }
  return hits;
}

export function serperErrorMessage(status: number, body: unknown): string {
  if (status === 401 || status === 403) {
    return "invalid or missing Serper API key";
  }
  if (status === 402) return "Serper quota exceeded";
  if (status === 429) return "Serper rate limit exceeded";
  if (body && typeof body === "object") {
    const msg = (body as Record<string, unknown>)["message"];
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }
  return `Serper HTTP ${status}`;
}

export async function runSerperSearch(
  query: string,
  max: number,
  opts?: SerperSearchOptions & { fetchImpl?: typeof fetch },
): Promise<WebSearchProviderOutcome> {
  const apiKey = resolveSerperApiKey(opts?.apiKey);
  if (!apiKey) {
    return { ok: false, error: "invalid or missing Serper API key" };
  }

  const gl = (opts?.gl ?? effectiveHarnessEnvRaw("AGENT_SERPER_GL") ?? "us").trim() || "us";
  const hl = (opts?.hl ?? effectiveHarnessEnvRaw("AGENT_SERPER_HL") ?? "en").trim() || "en";

  try {
    const res = await fetchWithRetry(
      SERPER_SEARCH_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({
          q: query,
          num: Math.max(1, Math.min(100, max)),
          gl,
          hl,
        }),
      },
      { timeoutMs: 15_000, fetchImpl: opts?.fetchImpl },
    );

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      return { ok: false, error: serperErrorMessage(res.status, body) };
    }

    const organic =
      body && typeof body === "object" ? (body as Record<string, unknown>)["organic"] : undefined;
    return { ok: true, hits: mapSerperOrganic(organic, max) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
