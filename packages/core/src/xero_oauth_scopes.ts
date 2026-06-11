/**
 * Xero OAuth 2.0 scope presets for Liminal connectors.
 *
 * Xero migrated to granular scopes on 2026-03-02. Apps created **before** that date
 * should authorize with legacy broad scopes (`accounting.transactions`,
 * `accounting.reports.read`) until migrated — requesting granular scopes on those
 * apps returns `invalid_scope`. Apps created on/after 2026-03-02 need granular only.
 *
 * Keep in sync with vireondynamics-website `src/lib/connect/xero-oauth.ts`.
 */
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export type XeroMode = "read_write" | "read_only";

/** Legacy broad scopes (default) vs post-2026-03-02 granular scopes. */
export type XeroScopeStyle = "legacy" | "granular";

export type XeroScopeOptions = {
  /** Request files, projects, payroll, and GL journal scopes (default false). */
  extended?: boolean;
  /** OAuth scope bundle; default legacy for maximum app compatibility. */
  style?: XeroScopeStyle;
};

const IDENTITY = ["openid", "profile", "email", "offline_access"] as const;

/**
 * Broad read scopes — use for apps created before 2026-03-02 (valid until Sep 2027).
 * See https://developer.xero.com/faq/granular-scopes
 */
export const XERO_LEGACY_READ_SCOPES = [
  "accounting.transactions.read",
  "accounting.reports.read",
  "accounting.contacts.read",
  "accounting.settings.read",
  "accounting.attachments.read",
  "accounting.budgets",
] as const;

/** Broad write scopes (paired with {@link XERO_LEGACY_READ_SCOPES}). */
export const XERO_LEGACY_WRITE_SCOPES = [
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
  "accounting.attachments",
] as const;

/** Granular read scopes (apps created on/after 2026-03-02). */
export const XERO_READ_SCOPES = [
  "accounting.invoices.read",
  "accounting.contacts.read",
  "accounting.settings.read",
  "accounting.payments.read",
  "accounting.banktransactions.read",
  "accounting.manualjournals.read",
  "accounting.attachments.read",
  "accounting.reports.aged.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.banksummary.read",
  "accounting.reports.executivesummary.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.trialbalance.read",
  "accounting.reports.taxreports.read",
] as const;

/** Granular write scopes. */
export const XERO_WRITE_SCOPES = [
  "accounting.invoices",
  "accounting.contacts",
  "accounting.settings",
  "accounting.payments",
  "accounting.banktransactions",
  "accounting.manualjournals",
  "accounting.attachments",
] as const;

/** Accounting scopes without a separate `.read` variant (budgets). */
export const XERO_STANDALONE_ACCOUNTING_SCOPES = ["accounting.budgets"] as const;

/** Extended — GL journals, Files, Projects, Payroll (separate API bases). */
export const XERO_PHASE3_READ_SCOPES = [
  "accounting.journals.read",
  "files.read",
  "projects.read",
  "payroll.employees.read",
  "payroll.payruns.read",
  "payroll.timesheets.read",
  "payroll.settings.read",
  "payroll.payslip.read",
] as const;

export const XERO_PHASE3_WRITE_SCOPES = [
  "files",
  "projects",
  "payroll.employees",
  "payroll.payruns",
  "payroll.timesheets",
  "payroll.settings",
] as const;

export function resolveXeroScopeStyle(): XeroScopeStyle {
  const raw = effectiveHarnessEnvRaw("AGENT_XERO_OAUTH_SCOPE_STYLE")?.trim().toLowerCase();
  if (raw === "granular") return "granular";
  return "legacy";
}

function scopesForLegacyMode(mode: XeroMode, extended: boolean): string[] {
  const read: string[] = [...XERO_LEGACY_READ_SCOPES];
  if (extended) read.push(...XERO_PHASE3_READ_SCOPES);
  if (mode === "read_only") {
    return [...IDENTITY, ...read];
  }
  const scopeSet = new Set<string>([
    ...read,
    ...XERO_LEGACY_WRITE_SCOPES,
    ...(extended ? XERO_PHASE3_READ_SCOPES : []),
    ...(extended ? XERO_PHASE3_WRITE_SCOPES : []),
  ]);
  return [...IDENTITY, ...scopeSet];
}

function scopesForGranularMode(mode: XeroMode, extended: boolean): string[] {
  const read: string[] = [...XERO_READ_SCOPES, ...XERO_STANDALONE_ACCOUNTING_SCOPES];
  if (extended) read.push(...XERO_PHASE3_READ_SCOPES);
  if (mode === "read_only") {
    return [...IDENTITY, ...read];
  }
  const scopeSet = new Set<string>([
    ...read,
    ...XERO_WRITE_SCOPES,
    ...XERO_STANDALONE_ACCOUNTING_SCOPES,
    ...(extended ? XERO_PHASE3_READ_SCOPES : []),
    ...(extended ? XERO_PHASE3_WRITE_SCOPES : []),
  ]);
  return [...IDENTITY, ...scopeSet];
}

export function scopesForXeroMode(mode: XeroMode, opts: XeroScopeOptions = {}): string[] {
  const style = opts.style ?? resolveXeroScopeStyle();
  const extended = opts.extended === true;
  if (style === "legacy") return scopesForLegacyMode(mode, extended);
  return scopesForGranularMode(mode, extended);
}

export const XERO_DEFAULT_MODE: XeroMode = "read_write";

/** Core accounting scopes tools expect on the token (granular names; legacy tokens satisfy via implies). */
export const XERO_CORE_SCOPES: readonly string[] = [
  ...new Set([...XERO_READ_SCOPES, ...XERO_WRITE_SCOPES, ...XERO_STANDALONE_ACCOUNTING_SCOPES]),
];

export const XERO_FULL_ACCOUNTING_SCOPES: readonly string[] = [...XERO_CORE_SCOPES];

export const XERO_FULL_SCOPES: readonly string[] = [
  ...new Set([
    ...XERO_CORE_SCOPES,
    ...XERO_PHASE3_READ_SCOPES,
    ...XERO_PHASE3_WRITE_SCOPES,
  ]),
];

/** Legacy broad scopes satisfy granular requirements on pre-migration tokens. */
const LEGACY_SCOPE_IMPLIES: Readonly<Record<string, readonly string[]>> = {
  "accounting.transactions.read": [
    "accounting.invoices.read",
    "accounting.payments.read",
    "accounting.banktransactions.read",
    "accounting.manualjournals.read",
    "accounting.attachments.read",
  ],
  "accounting.transactions": [
    "accounting.invoices",
    "accounting.payments",
    "accounting.banktransactions",
    "accounting.manualjournals",
    "accounting.attachments",
  ],
  "accounting.reports.read": [
    "accounting.reports.aged.read",
    "accounting.reports.balancesheet.read",
    "accounting.reports.banksummary.read",
    "accounting.reports.executivesummary.read",
    "accounting.reports.profitandloss.read",
    "accounting.reports.trialbalance.read",
    "accounting.reports.taxreports.read",
  ],
};

function scopeSatisfied(required: string, granted: Set<string>): boolean {
  if (granted.has(required)) return true;
  for (const [legacy, implied] of Object.entries(LEGACY_SCOPE_IMPLIES)) {
    if (granted.has(legacy) && implied.includes(required)) return true;
  }
  return false;
}

export function xeroBundleMissingCoreScopes(granted: string[] | undefined): string[] {
  const have = new Set((granted ?? []).map((s) => s.trim()).filter(Boolean));
  return XERO_CORE_SCOPES.filter((s) => !scopeSatisfied(s, have));
}

export function xeroBundleMissingScopes(granted: string[] | undefined): string[] {
  const have = new Set((granted ?? []).map((s) => s.trim()).filter(Boolean));
  return XERO_FULL_SCOPES.filter((s) => !scopeSatisfied(s, have));
}

export function xeroBundleMissingPhase3Scopes(granted: string[] | undefined): string[] {
  const have = new Set((granted ?? []).map((s) => s.trim()).filter(Boolean));
  const phase3 = [...new Set([...XERO_PHASE3_READ_SCOPES, ...XERO_PHASE3_WRITE_SCOPES])];
  return phase3.filter((s) => !scopeSatisfied(s, have));
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function xeroRequiredScopesForCall(opts: {
  apiBase: string;
  method?: string;
  path: string;
}): string[] {
  const method = (opts.method ?? "GET").toUpperCase();
  const write = WRITE_METHODS.has(method);
  const path = opts.path;

  if (opts.apiBase.includes("files.xro")) {
    return write ? ["files.read", "files"] : ["files.read"];
  }
  if (opts.apiBase.includes("projects.xro")) {
    return write ? ["projects.read", "projects"] : ["projects.read"];
  }
  if (opts.apiBase.includes("payroll.xro")) {
    if (path.includes("/Payslip")) return ["payroll.payslip.read"];
    if (path.includes("/Settings")) return ["payroll.settings.read"];
    if (path.includes("/PayRuns")) {
      return write ? ["payroll.payruns.read", "payroll.payruns"] : ["payroll.payruns.read"];
    }
    if (path.includes("/Timesheets")) {
      return write ? ["payroll.timesheets.read", "payroll.timesheets"] : ["payroll.timesheets.read"];
    }
    if (path.includes("/Employees")) {
      return write ? ["payroll.employees.read", "payroll.employees"] : ["payroll.employees.read"];
    }
    return ["payroll.employees.read"];
  }

  if (path.includes("/Journals")) return ["accounting.journals.read"];
  if (path.includes("/Budgets")) return ["accounting.budgets"];
  return [];
}

export function xeroBundleMissingRequiredScopes(
  granted: string[] | undefined,
  required: readonly string[]
): string[] {
  if (required.length === 0) return [];
  const have = new Set((granted ?? []).map((s) => s.trim()).filter(Boolean));
  return required.filter((s) => !scopeSatisfied(s, have));
}

export function formatXeroReconnectHint(missing: string[]): string {
  if (missing.length === 0) return "";
  const shown = missing.slice(0, 5).join(", ");
  const more = missing.length > 5 ? ", …" : "";
  const phase3 = missing.some(
    (s) =>
      s.startsWith("files") ||
      s.startsWith("projects") ||
      s.startsWith("payroll") ||
      s === "accounting.journals.read"
  );
  const extendedNote = phase3
    ? " Enable “Extended APIs” in Settings → Integrations before reconnecting."
    : "";
  return (
    `OAuth token is missing scopes (${shown}${more}). ` +
    "Settings → Integrations → Disconnect Xero, then Connect again (read+write) — token refresh alone does not add scopes." +
    extendedNote
  );
}
