import { effectiveHarnessEnvRaw } from "@liminal/core";
import { fetchWithRetry } from "../../shared/network_retry.js";
import { serperErrorMessage } from "./web_search_serper.js";

const SERPER_SCRAPE_URL = "https://scrape.serper.dev";

export interface SerperWebFetchOptions {
  apiKey?: string;
  charOffset?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export function isSerperWebFetchEnabled(): boolean {
  if (effectiveHarnessEnvRaw("AGENT_WEB_FETCH_SERPER") === "0") return false;
  const key = (effectiveHarnessEnvRaw("AGENT_SERPER_API_KEY") ?? "").trim();
  return key.length > 0;
}

/** Serper scrape needs a normal page URL and cannot discover HTML assets. */
export function shouldAttemptSerperWebFetch(
  url: string,
  opts?: { includeAssets?: boolean }
): boolean {
  if (!isSerperWebFetchEnabled()) return false;
  if (opts?.includeAssets) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const path = parsed.pathname.toLowerCase();
    if (/\.(pdf|png|jpe?g|gif|webp|bmp|svg|avif|zip|gz|tar|exe|dmg|deb|rpm)(\?|#|$)/i.test(path)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function sliceBodyWithPagination(
  body: string,
  charOffset: number,
  maxChars: number
): { slice: string; footer: string } {
  const offset = Math.max(0, charOffset);
  const cap = Math.max(500, maxChars);
  const total = body.length;
  const slice = body.slice(offset, offset + cap);
  let footer = "";
  if (offset + slice.length < total) {
    footer =
      `\n[truncated: showing chars ${offset}–${offset + slice.length} of ${total}. ` +
      `Re-fetch same url with char_offset=${offset + slice.length} to continue.]`;
  } else if (offset > 0) {
    footer = `\n[continued from char_offset ${offset}; ${total} chars total.]`;
  }
  return { slice, footer };
}

function formatSerperScrapeBody(
  url: string,
  markdown: string,
  text: string,
  metadata: Record<string, unknown> | undefined,
  credits: number | undefined
): string {
  const body = (markdown.trim() || text.trim()).replace(/\s+\n/g, "\n").trim();
  const lines: string[] = ["[Fetched via Serper scrape]"];
  const title =
    typeof metadata?.["title"] === "string"
      ? metadata["title"].trim()
      : typeof metadata?.["og:title"] === "string"
        ? String(metadata["og:title"]).trim()
        : "";
  if (title) lines.push(`Title: ${title}`);
  lines.push(`URL: ${url}`);
  if (typeof credits === "number" && Number.isFinite(credits)) {
    lines.push(`Serper credits: ${credits}`);
  }
  lines.push("", body);
  return lines.join("\n").trim();
}

export type SerperWebFetchOutcome =
  | { ok: true; output: string }
  | { ok: false; error: string; retryable: boolean };

export async function runSerperWebFetch(
  url: string,
  maxChars: number,
  opts?: SerperWebFetchOptions
): Promise<SerperWebFetchOutcome> {
  const apiKey = (opts?.apiKey ?? effectiveHarnessEnvRaw("AGENT_SERPER_API_KEY") ?? "").trim();
  if (!apiKey) {
    return { ok: false, error: "invalid or missing Serper API key", retryable: true };
  }

  const charOffset = Math.max(0, opts?.charOffset ?? 0);
  const signal = opts?.signal;

  try {
    const res = await fetchWithRetry(
      SERPER_SCRAPE_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({ url, includeMarkdown: true }),
        signal,
      },
      { timeoutMs: 25_000, fetchImpl: opts?.fetchImpl, externalSignal: signal }
    );

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      const msg = serperErrorMessage(res.status, body);
      const retryable = res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429;
      return { ok: false, error: msg, retryable };
    }

    const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const markdown = typeof row["markdown"] === "string" ? row["markdown"] : "";
    const text = typeof row["text"] === "string" ? row["text"] : "";
    const metadata =
      row["metadata"] && typeof row["metadata"] === "object"
        ? (row["metadata"] as Record<string, unknown>)
        : undefined;
    const credits = typeof row["credits"] === "number" ? row["credits"] : undefined;

    const combined = markdown.trim() || text.trim();
    if (combined.length < 80) {
      return {
        ok: false,
        error: "Serper scrape returned too little text",
        retryable: true,
      };
    }

    const formatted = formatSerperScrapeBody(url, markdown, text, metadata, credits);
    const { slice, footer } = sliceBodyWithPagination(formatted, charOffset, maxChars);
    return { ok: true, output: (slice + footer).trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, retryable: true };
  }
}
