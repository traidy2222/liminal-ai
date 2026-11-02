/**
 * Shared HTTP helpers for web_fetch (headers, charset, bot-wall heuristics).
 * Kept separate from network_retry to avoid changing web_search / markets_quote behavior.
 */
import { effectiveHarnessEnvRaw } from "@liminal/core";

/** Default aligns with Sec-CH-UA major version below. */
const DEFAULT_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const DEFAULT_FIREFOX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0";

/** Fallback Chrome major when UA is custom or unparsable. */
const DEFAULT_CHROME_MAJOR = 136;

/** Chrome-style navigation Accept (matches real Chromium top-level document requests). */
const CHROME_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";

/** Firefox top-level HTML Accept (Gecko omits sxg/avif bundle quirks vary; keep broad). */
const FIREFOX_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

export type WebFetchHeaderProfile = "primary" | "alt" | "chrome_cross_site";

/** Normalize charset label for TextDecoder (Node supports windows-1252, iso-8859-1, utf-8, …). */
export function parseCharsetFromContentType(contentType: string | null | undefined): string {
  const ct = (contentType ?? "").trim();
  if (!ct) return "utf-8";
  const m = /charset\s*=\s*["']?([^"';\s]+)/i.exec(ct);
  if (!m?.[1]) return "utf-8";
  let label = m[1].trim().toLowerCase();
  if (label === "x-user-defined") return "utf-8";
  if (label === "iso8859-1" || label === "latin-1" || label === "latin1") return "iso-8859-1";
  if (label === "cp1252" || label === "windows-1252") return "windows-1252";
  return label;
}

/** Safe TextDecoder label: invalid names fall back to utf-8. */
export function resolveTextDecoderLabel(label: string): string {
  const t = label.trim().toLowerCase() || "utf-8";
  try {
    new TextDecoder(t, { fatal: false });
    return t;
  } catch {
    return "utf-8";
  }
}

function parseChromeMajorFromUa(ua: string): number {
  const m = /\bChrome\/(\d+)/.exec(ua);
  if (m?.[1]) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 90 && n <= 299) return n;
  }
  return DEFAULT_CHROME_MAJOR;
}

/** Client hints only make sense when the UA presents as Chromium (not Edge string, not Firefox). */
function shouldSendChromeClientHints(ua: string): boolean {
  if (!/\bChrome\/\d+/i.test(ua)) return false;
  if (/\bEdg\//i.test(ua)) return false;
  if (/\bFirefox\//i.test(ua)) return false;
  return true;
}

function chromeClientHintHeaders(ua: string): Record<string, string> {
  if (!shouldSendChromeClientHints(ua)) return {};
  const major = parseChromeMajorFromUa(ua);
  const full = `${major}.0.0.0`;
  const brandOtherShort = '"Not.A/Brand";v="24"';
  const brandOtherFull = '"Not.A/Brand";v="24.0.0.0"';
  return {
    "sec-ch-ua": `"Chromium";v="${major}", "Google Chrome";v="${major}", ${brandOtherShort}`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-ch-ua-full-version-list": `"Chromium";v="${full}", "Google Chrome";v="${full}", ${brandOtherFull}`,
  };
}

function buildChromeDocumentHeaders(
  ua: string,
  site: "none" | "cross-site",
  referer?: string
): Record<string, string> {
  const lang = effectiveHarnessEnvRaw("AGENT_WEB_FETCH_ACCEPT_LANGUAGE")?.trim() || "en-US,en;q=0.9";
  const platform =
    effectiveHarnessEnvRaw("AGENT_WEB_FETCH_SEC_CH_PLATFORM")?.trim() || '"Windows"';
  const ch = chromeClientHintHeaders(ua);
  if (ch["sec-ch-ua-platform"]) {
    ch["sec-ch-ua-platform"] = platform.startsWith('"') ? platform : `"${platform.replace(/"/g, "")}"`;
  }
  const headers: Record<string, string> = {
    "User-Agent": ua,
    Accept: CHROME_ACCEPT,
    "Accept-Language": lang,
    // Omit zstd: some CDNs serve zstd when offered; Node fetch may not transparently decode it → binary garbage in "text".
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": site,
    "Sec-Fetch-User": "?1",
    Priority: "u=0, i",
    "Cache-Control": "max-age=0",
    ...ch,
  };
  if (referer) headers["Referer"] = referer;
  return headers;
}

function buildFirefoxDocumentHeaders(ua: string, referer: string): Record<string, string> {
  const lang = effectiveHarnessEnvRaw("AGENT_WEB_FETCH_ACCEPT_LANGUAGE")?.trim() || "en-US,en;q=0.9";
  return {
    "User-Agent": ua,
    Accept: FIREFOX_ACCEPT,
    "Accept-Language": lang,
    // Omit zstd: some CDNs serve zstd when offered; Node fetch may not transparently decode it → binary garbage in "text".
    "Accept-Encoding": "gzip, deflate, br",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
    Referer: referer,
  };
}

/**
 * Browser-like RequestInit for HTML navigation fetches.
 * - primary: Chromium document request (direct / typed URL).
 * - alt: Gecko cross-site from search (DataDome / some edges accept this when raw Chrome fails).
 * - chrome_cross_site: same Chromium fingerprint as primary but Referer + cross-site (third retry).
 */
export function buildWebFetchInit(profile: WebFetchHeaderProfile): RequestInit {
  const uaPrimary = effectiveHarnessEnvRaw("AGENT_WEB_FETCH_USER_AGENT")?.trim() || DEFAULT_CHROME_UA;
  const uaAlt = effectiveHarnessEnvRaw("AGENT_WEB_FETCH_ALT_USER_AGENT")?.trim() || DEFAULT_FIREFOX_UA;
  const refererSearch =
    effectiveHarnessEnvRaw("AGENT_WEB_FETCH_REFERER")?.trim() || "https://www.google.com/";

  let headers: Record<string, string>;
  if (profile === "primary") {
    headers = buildChromeDocumentHeaders(uaPrimary, "none");
  } else if (profile === "chrome_cross_site") {
    headers = buildChromeDocumentHeaders(uaPrimary, "cross-site", refererSearch);
  } else {
    headers = buildFirefoxDocumentHeaders(uaAlt, refererSearch);
  }

  return { headers, redirect: "follow" as RequestRedirect };
}

/** Match CDN / anti-bot interstitials (incl. DataDome "Please enable JS" pages that omit "javascript"). */
const BOT_WALL_RE =
  /cloudflare|cf-ray|attention required|access denied|blocked|bot.?check|checking your browser|enable javascript|enable\s+js\b|please enable js|ad blocker|captcha-delivery|datadome|forbidden|ddos.?protection/i;

/** Peek at decoded ASCII-ish snippet for CDN / bot interstitial markers. */
export function peekLooksLikeBotWall(text: string): boolean {
  const s = text.slice(0, 24_000);
  return BOT_WALL_RE.test(s);
}

/**
 * Build fallback reader URL from template. `{url}` is replaced with encodeURIComponent(originalUrl).
 * Returns null if env unset or invalid.
 */
export function buildFallbackFetchUrl(originalUrl: string): string | null {
  const tpl = effectiveHarnessEnvRaw("AGENT_WEB_FETCH_FALLBACK_URL_TEMPLATE")?.trim();
  if (!tpl || !tpl.includes("{url}")) return null;
  try {
    return tpl.replace(/\{url\}/g, encodeURIComponent(originalUrl));
  } catch {
    return null;
  }
}

/** Decode a full byte buffer using charset from Content-Type (for tests and reuse). */
export function decodeBodyWithCharset(bytes: Uint8Array, contentType: string | null | undefined): string {
  const label = resolveTextDecoderLabel(parseCharsetFromContentType(contentType));
  return new TextDecoder(label, { fatal: false }).decode(bytes);
}

export function is403RetryEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_WEB_FETCH_403_RETRY") !== "0";
}
