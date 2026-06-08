/**
 * Shared helpers for Google Docs / Sheets / Slides classic REST tools.
 */
import { effectiveHarnessEnvRaw, getGoogleAccessToken } from "@liminal/core";
import type { PropertySchema } from "@liminal/core";

export const DOCS_BASE = "https://docs.googleapis.com/v1";
export const SHEETS_BASE = "https://sheets.googleapis.com/v4";
export const SLIDES_BASE = "https://slides.googleapis.com/v1";
export const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

export function officeRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_GOOGLE_OFFICE_REST") !== "0";
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function objectSchema(description: string): PropertySchema {
  return { type: "object", description, additionalProperties: true } as PropertySchema;
}

export function arraySchema(description: string, items?: PropertySchema): PropertySchema {
  return {
    type: "array",
    description,
    items: items ?? objectSchema("Item"),
  } as PropertySchema;
}

export async function googleOfficeApiJson<T>(
  base: string,
  apiLabel: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!officeRestEnabled()) {
    return { ok: false, error: "Office REST tools are off (set AGENT_GOOGLE_OFFICE_REST=1)." };
  }
  const token = await getGoogleAccessToken();
  if (!token) {
    return {
      ok: false,
      error:
        "No Google OAuth token. Connect via Settings → Integrations or `liminal connect google --attach`.",
    };
  }
  const url = path.startsWith("http") ? path : `${base}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 500);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* use raw */
    }
    return { ok: false, error: `${apiLabel} HTTP ${res.status}: ${detail}` };
  }
  if (!text.trim()) return { ok: true, data: {} as T };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: `${apiLabel} returned non-JSON body` };
  }
}

export async function googleOfficeApiBinary(
  base: string,
  apiLabel: string,
  path: string
): Promise<{ ok: true; data: Buffer; contentType: string } | { ok: false; error: string }> {
  if (!officeRestEnabled()) {
    return { ok: false, error: "Office REST tools are off (set AGENT_GOOGLE_OFFICE_REST=1)." };
  }
  const token = await getGoogleAccessToken();
  if (!token) {
    return {
      ok: false,
      error:
        "No Google OAuth token. Connect via Settings → Integrations or `liminal connect google --attach`.",
    };
  }
  const url = path.startsWith("http") ? path : `${base}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${apiLabel} HTTP ${res.status}: ${text.slice(0, 400)}` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  return { ok: true, data: buf, contentType };
}
