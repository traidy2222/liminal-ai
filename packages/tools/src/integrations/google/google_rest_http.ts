/**
 * Shared HTTP helper for Google REST integrations (Analytics, Search Console, …).
 */
import { effectiveHarnessEnvRaw, getGoogleAccessToken } from "@liminal/core";
import type { ToolResult } from "@liminal/core";

export function googleRestEnvEnabled(envKey: string): boolean {
  return effectiveHarnessEnvRaw(envKey) !== "0";
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export async function googleRestJson<T>(
  url: string,
  opts: {
    envKey: string;
    serviceLabel: string;
    init?: RequestInit;
  }
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!googleRestEnvEnabled(opts.envKey)) {
    return { ok: false, error: `${opts.serviceLabel} REST tools are off (set ${opts.envKey}=1).` };
  }
  const token = await getGoogleAccessToken();
  if (!token) {
    return {
      ok: false,
      error:
        "No Google OAuth token. Connect via Settings → Integrations or `liminal connect google --attach`.",
    };
  }
  const fullUrl = url.startsWith("http") ? url : `https://www.googleapis.com${url}`;
  let res: Response;
  try {
    res = await fetch(fullUrl, {
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
      /* use raw */
    }
    return { ok: false, error: `${opts.serviceLabel} API HTTP ${res.status}: ${detail}` };
  }
  if (!text.trim()) return { ok: true, data: {} as T };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: `${opts.serviceLabel} API returned non-JSON body` };
  }
}

export function jsonToolResult(data: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(data, null, 2) };
}

/** Normalize GA4 property id to `properties/123456789`. */
export function normalizeGa4PropertyId(raw: string): string {
  const s = raw.trim();
  if (!s) return "properties/0";
  if (s.startsWith("properties/")) return s;
  const digits = s.replace(/\D/g, "");
  return `properties/${digits || s}`;
}
