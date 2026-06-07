/**
 * Per-app HTTP proxy allowlist for sandboxed widget windows.
 */

const DEFAULT_MAX_HOSTS = 8;

export function appProxyMaxHosts(): number {
  const raw = Number(process.env["AGENT_APP_PROXY_MAX_HOSTS"] ?? String(DEFAULT_MAX_HOSTS));
  return Number.isFinite(raw) ? Math.max(1, Math.min(32, raw)) : DEFAULT_MAX_HOSTS;
}

export function normalizeProxyHosts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const h = String(item ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      ?.split(":")[0];
    if (h && h.length > 0 && !out.includes(h)) out.push(h);
    if (out.length >= appProxyMaxHosts()) break;
  }
  return out;
}

export function extractHostsFromDataFetch(url: string): string[] {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return [];
    const host = u.hostname.toLowerCase();
    return host ? [host] : [];
  } catch {
    return [];
  }
}

export function isProxyUrlAllowed(
  targetUrl: string,
  allowHosts: readonly string[]
): boolean {
  if (allowHosts.length === 0) return false;
  try {
    const u = new URL(targetUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return allowHosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}
