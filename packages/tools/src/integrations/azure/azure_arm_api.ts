/**
 * Azure Resource Manager URL + api-version helpers (Microsoft Learn REST reference).
 * @see https://learn.microsoft.com/en-us/rest/api/resources/
 */

/** Stable api-version pins from Microsoft.ResourceManagement docs. */
export const ARM_API_VERSION = {
  subscriptions: "2022-12-01",
  resourceGroups: "2021-04-01",
  resources: "2021-04-01",
  providers: "2021-04-01",
  deployments: "2022-09-01",
  tags: "2021-04-01",
} as const;

export function normalizeArmPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function inferArmApiVersion(pathname: string): string | undefined {
  const p = pathname.toLowerCase();
  if (p === "/subscriptions") return ARM_API_VERSION.subscriptions;
  if (/^\/subscriptions\/[^/]+\/locations\/?$/i.test(pathname)) return ARM_API_VERSION.subscriptions;
  if (/^\/subscriptions\/[^/]+\/?$/i.test(pathname)) return ARM_API_VERSION.subscriptions;
  if (/\/resourcegroups(\/|$)/i.test(pathname)) return ARM_API_VERSION.resourceGroups;
  if (/\/providers\/microsoft\.resources\/deployments/i.test(pathname)) {
    return ARM_API_VERSION.deployments;
  }
  if (/\/resources(\/|$)/i.test(pathname) || /\/providers\/[^/]+\/[^/]+/i.test(pathname)) {
    return ARM_API_VERSION.resources;
  }
  if (p === "/providers" || /^\/providers\/[^/]+\/?$/i.test(pathname)) {
    return ARM_API_VERSION.providers;
  }
  return undefined;
}

export function ensureArmApiVersion(path: string, explicit?: string): string {
  const trimmed = path.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const u = new URL(trimmed);
    if (!u.searchParams.has("api-version")) {
      const ver =
        explicit ?? inferArmApiVersion(u.pathname) ?? ARM_API_VERSION.resources;
      u.searchParams.set("api-version", ver);
    }
    return u.toString();
  }
  const rel = normalizeArmPath(trimmed);
  if (rel.includes("api-version=")) return rel;
  const [pathname] = rel.split("?");
  const ver = explicit ?? inferArmApiVersion(pathname ?? rel) ?? ARM_API_VERSION.resources;
  const sep = rel.includes("?") ? "&" : "?";
  return `${rel}${sep}api-version=${encodeURIComponent(ver)}`;
}

export function buildArmUrl(path: string, apiVersion?: string): string {
  const withVersion = ensureArmApiVersion(path, apiVersion);
  if (withVersion.startsWith("http://") || withVersion.startsWith("https://")) {
    return withVersion;
  }
  return `https://management.azure.com${withVersion}`;
}

export interface ParsedArmResourceId {
  subscriptionId?: string;
  resourceGroup?: string;
  providerNamespace?: string;
  resourceType?: string;
  resourceName?: string;
}

export function parseArmResourceId(resourceId: string): ParsedArmResourceId {
  let id = resourceId.trim();
  if (!id.startsWith("/")) id = `/${id}`;
  const sub = id.match(/\/subscriptions\/([^/]+)/i)?.[1];
  const rg = id.match(/\/resourceGroups\/([^/]+)/i)?.[1];
  const provider = id.match(/\/providers\/([^/]+)\/([^/]+)(?:\/([^/]+))?/i);
  return {
    subscriptionId: sub,
    resourceGroup: rg,
    providerNamespace: provider?.[1],
    resourceType: provider?.[2],
    resourceName: provider?.[3],
  };
}

/** Prefer latest stable (non-preview) provider api-version. */
export function pickArmApiVersion(versions: string[]): string | undefined {
  if (!versions.length) return undefined;
  const stable = versions.filter(
    (v) => !/-preview$/i.test(v) && !/-alpha$/i.test(v) && !/-beta$/i.test(v)
  );
  const pool = (stable.length > 0 ? stable : versions).slice();
  pool.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return pool[0];
}
