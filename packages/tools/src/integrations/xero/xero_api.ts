/**
 * Shared Xero Accounting API client (OAuth + xero-tenant-id).
 */
import {
  effectiveHarnessEnvRaw,
  getXeroAccessToken,
  listXeroOAuthAccounts,
  readOAuthBundle,
  resolveXeroTenantId,
  formatXeroReconnectHint,
  xeroBundleMissingRequiredScopes,
  xeroBundleMissingScopes,
  xeroRequiredScopesForCall,
  type OAuthTokenBundle,
} from "@liminal/core";
import type { PropertySchema, ToolResult } from "@liminal/core";
import { integrationNotConnectedError } from "../core/integration_oauth_start.js";
import { formatXeroApiError } from "./xero_validation.js";
import {
  XERO_ACCOUNTING_API,
  XERO_FILES_API,
  type XeroApiBase,
} from "./xero_api_bases.js";

export {
  XERO_ACCOUNTING_API,
  XERO_FILES_API,
  XERO_PROJECTS_API,
  XERO_PAYROLL_AU_API,
  XERO_PAYROLL_UK_NZ_API,
  XERO_API_BASES,
} from "./xero_api_bases.js";
export type { XeroApiBase } from "./xero_api_bases.js";

export function xeroRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_XERO_REST") !== "0";
}

export async function resolveXeroAuth(accountHint?: string): Promise<{
  token: string;
  bundle: OAuthTokenBundle;
} | null> {
  const accounts = await listXeroOAuthAccounts();
  const match = accountHint
    ? accounts.find(
        (a) =>
          a.accountId === accountHint ||
          a.email?.toLowerCase() === accountHint.toLowerCase()
      )
    : accounts[0];
  const accountId = match?.accountId ?? accounts[0]?.accountId;
  const token = await getXeroAccessToken(accountId);
  if (!token) return null;
  const bundle = await readOAuthBundle("xero", accountId);
  if (!bundle) return null;
  return { token, bundle };
}

export type XeroFetchOpts = {
  method?: string;
  body?: unknown;
  accountHint?: string;
  tenantId?: string;
  accept?: string;
  contentType?: string;
  bodyRaw?: Buffer | Uint8Array;
  /** multipart/form-data body (Content-Type set automatically). */
  bodyForm?: FormData;
  query?: URLSearchParams;
  /** API base URL (default: Accounting 2.0). */
  apiBase?: XeroApiBase;
};

/** Parent resource types that support Accounting API attachments. */
export const XERO_ATTACHMENT_PARENTS = [
  "Invoices",
  "CreditNotes",
  "Accounts",
  "Contacts",
  "ManualJournals",
  "PurchaseOrders",
  "BankTransactions",
  "Quotes",
] as const;

export type XeroAttachmentParent = (typeof XERO_ATTACHMENT_PARENTS)[number];

export function isXeroAttachmentParent(v: string): v is XeroAttachmentParent {
  return (XERO_ATTACHMENT_PARENTS as readonly string[]).includes(v);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildXeroUrl(path: string, apiBase: XeroApiBase, query?: URLSearchParams): string {
  let url = path.startsWith("http")
    ? path
    : `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
  if (query?.toString()) {
    url += `${url.includes("?") ? "&" : "?"}${query.toString()}`;
  }
  return url;
}

export async function xeroFetch(
  path: string,
  opts: XeroFetchOpts = {}
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const auth = await resolveXeroAuth(opts.accountHint);
  if (!auth) {
    return { ok: false, error: integrationNotConnectedError("xero") };
  }
  const tenantId = resolveXeroTenantId(auth.bundle, opts.tenantId);
  if (!tenantId) {
    return {
      ok: false,
      error: "no Xero organisation (tenant) on this connection — reconnect Xero",
    };
  }
  const apiBase = opts.apiBase ?? XERO_ACCOUNTING_API;
  const requiredScopes = xeroRequiredScopesForCall({
    apiBase,
    method: opts.method,
    path,
  });
  const missingPreflight = xeroBundleMissingRequiredScopes(auth.bundle.scopes, requiredScopes);
  if (missingPreflight.length > 0) {
    return { ok: false, error: formatXeroReconnectHint(missingPreflight) };
  }

  const url = buildXeroUrl(path, apiBase, opts.query);

  const isRawBody = opts.bodyRaw !== undefined;
  const isForm = opts.bodyForm !== undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    Accept: opts.accept ?? "application/json",
    "xero-tenant-id": tenantId,
  };
  if (isForm) {
    /* fetch sets multipart boundary */
  } else if (isRawBody) {
    headers["Content-Type"] = opts.contentType ?? "application/octet-stream";
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = opts.contentType ?? "application/json";
  }

  let lastError = "";
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: isForm
        ? opts.bodyForm
        : isRawBody
          ? Buffer.from(opts.bodyRaw!)
          : opts.body !== undefined
            ? JSON.stringify(opts.body)
            : undefined,
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* plain text or binary meta */
    }
    if (res.status === 429 && attempt < 3) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000);
      continue;
    }
    if (!res.ok) {
      lastError = formatXeroApiError(res.status, data, text);
      if (res.status === 401) {
        const missingCall = xeroBundleMissingRequiredScopes(auth.bundle.scopes, requiredScopes);
        const missing =
          missingCall.length > 0 ? missingCall : xeroBundleMissingScopes(auth.bundle.scopes);
        const hint = formatXeroReconnectHint(missing);
        if (hint) lastError += ` — ${hint}`;
        else {
          lastError +=
            " — try disconnecting and reconnecting Xero in Settings → Integrations to refresh scopes.";
        }
      }
      return { ok: false, error: lastError };
    }
    return { ok: true, data };
  }
  return { ok: false, error: lastError || "Xero request failed" };
}

export function jsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function xeroHint(args: Record<string, unknown>): string | undefined {
  return typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
}

export function xeroTenant(args: Record<string, unknown>): string | undefined {
  return typeof args["tenant_id"] === "string" ? args["tenant_id"] : undefined;
}

export function xeroPageParams(args: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  if (typeof args["where"] === "string" && args["where"].trim()) {
    params.set("where", args["where"].trim());
  }
  if (typeof args["order"] === "string" && args["order"].trim()) {
    params.set("order", args["order"].trim());
  }
  if (typeof args["page"] === "number" && args["page"] > 0) {
    params.set("page", String(Math.floor(args["page"])));
  }
  if (typeof args["status"] === "string" && args["status"].trim()) {
    params.set("Statuses", args["status"].trim());
  }
  return params;
}

export function xeroPathWithQuery(base: string, params: URLSearchParams): string {
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

export function xeroCommonProps(): Record<string, PropertySchema> {
  return {
    account_hint: { type: "string", description: "Optional connected account email or id." },
    tenant_id: { type: "string", description: "Override Xero organisation tenant id." },
    page: { type: "number", description: "Page number (1-based)." },
    where: { type: "string", description: 'Xero where filter, e.g. Name.Contains("Acme")' },
    order: { type: "string", description: "Order clause, e.g. UpdatedDateUTC DESC" },
  };
}

export function xeroReportParams(args: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["fromDate", "toDate", "date", "periods", "timeframe", "trackingOptionID1", "trackingOptionID2"] as const) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) params.set(key, v.trim());
  }
  if (typeof args["standardLayout"] === "boolean") {
    params.set("standardLayout", String(args["standardLayout"]));
  }
  return params;
}

export function asToolResult(
  r: { ok: true; data: unknown } | { ok: false; error: string }
): ToolResult {
  if (!r.ok) return r;
  return { ok: true, output: jsonOutput(r.data) };
}

export async function xeroFetchBinary(
  path: string,
  opts: Omit<XeroFetchOpts, "body" | "bodyRaw" | "bodyForm"> = {}
): Promise<
  | { ok: true; data: Buffer; contentType: string }
  | { ok: false; error: string }
> {
  const auth = await resolveXeroAuth(opts.accountHint);
  if (!auth) {
    return { ok: false, error: integrationNotConnectedError("xero") };
  }
  const tenantId = resolveXeroTenantId(auth.bundle, opts.tenantId);
  if (!tenantId) {
    return { ok: false, error: "no Xero organisation (tenant) on this connection — reconnect Xero" };
  }
  const apiBase = opts.apiBase ?? XERO_ACCOUNTING_API;
  const url = buildXeroUrl(path, apiBase, opts.query);

  let lastError = "";
  for (let attempt = 0; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: opts.accept ?? "*/*",
        "xero-tenant-id": tenantId,
      },
    });
    if (res.status === 429 && attempt < 3) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      lastError = `Xero HTTP ${res.status}: ${text.slice(0, 500)}`;
      return { ok: false, error: lastError };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, data: buf, contentType: res.headers.get("Content-Type") ?? "application/octet-stream" };
  }
  return { ok: false, error: lastError || "Xero request failed" };
}

export async function xeroUploadAttachment(
  parentType: XeroAttachmentParent,
  parentId: string,
  fileName: string,
  body: Buffer,
  opts: {
    accountHint?: string;
    tenantId?: string;
    includeOnline?: boolean;
    contentType?: string;
  } = {}
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const query = new URLSearchParams();
  if (opts.includeOnline === true) query.set("IncludeOnline", "true");
  return xeroFetch(
    `/${parentType}/${encodeURIComponent(parentId)}/Attachments/${encodeURIComponent(fileName)}`,
    {
      method: "PUT",
      bodyRaw: body,
      contentType: opts.contentType ?? "application/octet-stream",
      accountHint: opts.accountHint,
      tenantId: opts.tenantId,
      query,
    }
  );
}
