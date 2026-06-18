/**
 * Shared HTTP helper for YouTube Data API v3 REST tools.
 */
import { effectiveHarnessEnvRaw, getYoutubeAccessToken } from "@liminal/core";
import type { ToolResult } from "@liminal/core";

export const YOUTUBE_REST_ENV_KEY = "AGENT_YOUTUBE_REST";
const YT_DATA_BASE = "https://www.googleapis.com/youtube/v3";
const YT_ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2";

export function youtubeRestEnabled(): boolean {
  return effectiveHarnessEnvRaw(YOUTUBE_REST_ENV_KEY) !== "0";
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export async function youtubeRestJson<T>(
  path: string,
  opts: { init?: RequestInit } = {}
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!youtubeRestEnabled()) {
    return { ok: false, error: `YouTube REST tools are off (set ${YOUTUBE_REST_ENV_KEY}=1).` };
  }
  const token = await getYoutubeAccessToken();
  if (!token) {
    return {
      ok: false,
      error:
        "No YouTube channel connected. Use Settings → Integrations → YouTube or connect_provider({ provider: \"youtube\", start_oauth: true }).",
    };
  }
  const url = path.startsWith("http") ? path : `${YT_DATA_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...opts.init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(opts.init?.body ? { "Content-Type": "application/json" } : {}),
        ...(opts.init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 600);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* raw */
    }
    if (/insufficient.*permission|insufficient authentication scopes|403/i.test(detail)) {
      detail +=
        " — reconnect YouTube with Read + write (needs https://www.googleapis.com/auth/youtube for video updates). Settings → Integrations → YouTube → Reconnect.";
    }
    return { ok: false, error: `YouTube API HTTP ${res.status}: ${detail}` };
  }
  if (!text.trim()) return { ok: true, data: {} as T };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: "YouTube API returned non-JSON body" };
  }
}

export function jsonToolResult(data: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(data, null, 2) };
}

export async function youtubeAnalyticsJson<T>(
  path: string,
  opts: { init?: RequestInit } = {}
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!youtubeRestEnabled()) {
    return { ok: false, error: `YouTube REST tools are off (set ${YOUTUBE_REST_ENV_KEY}=1).` };
  }
  const token = await getYoutubeAccessToken();
  if (!token) {
    return {
      ok: false,
      error:
        "No YouTube channel connected. Use Settings → Integrations → YouTube or connect_provider({ provider: \"youtube\", start_oauth: true }).",
    };
  }
  const url = path.startsWith("http") ? path : `${YT_ANALYTICS_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...opts.init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(opts.init?.body ? { "Content-Type": "application/json" } : {}),
        ...(opts.init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 600);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* raw */
    }
    if (/insufficient.*permission|403/i.test(detail)) {
      detail += " — reconnect YouTube with analytics scopes (Settings → Integrations → YouTube).";
    }
    return { ok: false, error: `YouTube Analytics HTTP ${res.status}: ${detail}` };
  }
  if (!text.trim()) return { ok: true, data: {} as T };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: "YouTube Analytics returned non-JSON body" };
  }
}
