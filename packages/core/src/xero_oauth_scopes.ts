/**
 * Xero OAuth 2.0 scope presets for Liminal connectors.
 *
 * **Post-2026-03-02 apps** (default): granular scopes only — `accounting.transactions` and
 * `accounting.reports.read` return `invalid_scope`. Use `accounting.budgets.read` for read
 * access (bare `accounting.budgets` alone is wrong on the authorize URL for new apps).
 *
 * **Pre-2026-03-02 apps**: set `AGENT_XERO_OAUTH_SCOPE_STYLE=legacy`.
 *
 * Keep in sync with vireondynamics-website `src/lib/connect/xero-oauth.ts`.
 */
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export type XeroMode = "read_write" | "read_only";

export type XeroScopeStyle = "legacy" | "granular";

/** OAuth authorize URL breadth — start with `connect`, add `full` for reports/budgets. */
export type XeroOAuthTier = "connect" | "full";

export type XeroScopeOptions = {
  extended?: boolean;
  /** `legacy` only for Xero apps created before 2026-03-02. */
  style?: XeroScopeStyle;
  /** Authorize tier (granular only). Default `connect` — smallest scope set that signs in. */
  tier?: XeroOAuthTier;
  /** GL journals (`accounting.journals.read`) — requires Xero approval on many apps. */
  journals?: boolean;
};

const IDENTITY = ["openid", "profile", "email", "offline_access"] as const;

export const XERO_LEGACY_READ_SCOPES = [
  "accounting.transactions.read",
  "accounting.reports.read",
  "accounting.contacts.read",
  "accounting.settings.read",
  "accounting.attachments.read",
  "accounting.budgets",
] as const;

export const XERO_LEGACY_WRITE_SCOPES = [
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
  "accounting.attachments",
] as const;

/** Minimum granular read set for post-2026-03-02 connect (invoices, contacts, payments, …). */
export const XERO_CONNECT_GRANULAR_READ_SCOPES = [
  "accounting.invoices.read",
  "accounting.contacts.read",
  "accounting.settings.read",
  "accounting.payments.read",
  "accounting.banktransactions.read",
  "accounting.manualjournals.read",
  "accounting.attachments.read",
] as const;

/** Minimum granular write set (omits `accounting.banktransactions` — not on all new-app manifests). */
export const XERO_CONNECT_GRANULAR_WRITE_SCOPES = [
  "accounting.invoices",
  "accounting.contacts",
  "accounting.settings",
  "accounting.payments",
  "accounting.manualjournals",
  "accounting.attachments",
] as const;

export const XERO_REPORT_READ_SCOPES = [
  "accounting.reports.aged.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.banksummary.read",
  "accounting.reports.executivesummary.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.trialbalance.read",
  "accounting.reports.taxreports.read",
] as const;

/** Post-2026-03-02 budget read scope (OpenAPI + Chift); not `accounting.budgets` alone. */
export const XERO_BUDGET_READ_SCOPE = "accounting.budgets.read" as const;

/** Optional write access to budgets (full tier / legacy). */
export const XERO_BUDGET_WRITE_SCOPE = "accounting.budgets" as const;

/** Full granular read = connect + reports + budgets.read */
export const XERO_READ_SCOPES = [
  ...XERO_CONNECT_GRANULAR_READ_SCOPES,
  ...XERO_REPORT_READ_SCOPES,
  XERO_BUDGET_READ_SCOPE,
] as const;

/** Full granular write = connect + banktransactions write + budgets write */
export const XERO_WRITE_SCOPES = [
  ...XERO_CONNECT_GRANULAR_WRITE_SCOPES,
  "accounting.banktransactions",
  XERO_BUDGET_WRITE_SCOPE,
] as const;

/** @deprecated Use {@link XERO_BUDGET_READ_SCOPE} / {@link XERO_BUDGET_WRITE_SCOPE}. */
export const XERO_STANDALONE_ACCOUNTING_SCOPES = [XERO_BUDGET_WRITE_SCOPE] as const;

/** Files, projects, payroll — enable products on the Xero app first. */
export const XERO_PHASE3_READ_SCOPES = [
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

/** GL journals — separate from phase 3; often requires Xero developer approval. */
export const XERO_JOURNALS_READ_SCOPE = "accounting.journals.read" as const;

export function resolveXeroScopeStyle(): XeroScopeStyle {
  const raw = effectiveHarnessEnvRaw("AGENT_XERO_OAUTH_SCOPE_STYLE")?.trim().toLowerCase();
  if (raw === "legacy") return "legacy";
  return "granular";
}

function resolveTier(opts: XeroScopeOptions): XeroOAuthTier {
  return opts.tier === "full" ? "full" : "connect";
}

function scopesForLegacyMode(mode: XeroMode, extended: boolean, journals: boolean): string[] {
  const read: string[] = [...XERO_LEGACY_READ_SCOPES];
  if (journals) read.push(XERO_JOURNALS_READ_SCOPE);
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

function scopesForGranularMode(mode: XeroMode, opts: XeroScopeOptions): string[] {
  const tier = resolveTier(opts);
  const extended = opts.extended === true;
  const journals = opts.journals === true;

  const read: string[] =
    tier === "full"
      ? [...XERO_READ_SCOPES]
      : [...XERO_CONNECT_GRANULAR_READ_SCOPES];

  if (journals) read.push(XERO_JOURNALS_READ_SCOPE);
  if (extended) read.push(...XERO_PHASE3_READ_SCOPES);

  if (mode === "read_only") {
    return [...IDENTITY, ...read];
  }

  const write =
    tier === "full" ? [...XERO_WRITE_SCOPES] : [...XERO_CONNECT_GRANULAR_WRITE_SCOPES];

  const scopeSet = new Set<string>([
    ...read,
    ...write,
    ...(extended ? XERO_PHASE3_READ_SCOPES : []),
    ...(extended ? XERO_PHASE3_WRITE_SCOPES : []),
  ]);
  return [...IDENTITY, ...scopeSet];
}

export function scopesForXeroMode(mode: XeroMode, opts: XeroScopeOptions = {}): string[] {
  const style = opts.style ?? resolveXeroScopeStyle();
  const journals = opts.journals === true;
  if (style === "legacy") return scopesForLegacyMode(mode, opts.extended === true, journals);
  return scopesForGranularMode(mode, opts);
}

export const XERO_DEFAULT_MODE: XeroMode = "read_write";

export const XERO_CORE_SCOPES: readonly string[] = [
  ...new Set([...XERO_READ_SCOPES, ...XERO_WRITE_SCOPES]),
];

export const XERO_FULL_ACCOUNTING_SCOPES: readonly string[] = [...XERO_CORE_SCOPES];

export const XERO_FULL_SCOPES: readonly string[] = [
  ...new Set([
    ...XERO_CORE_SCOPES,
    XERO_JOURNALS_READ_SCOPE,
    ...XERO_PHASE3_READ_SCOPES,
    ...XERO_PHASE3_WRITE_SCOPES,
  ]),
];

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
  "accounting.reports.read": [...XERO_REPORT_READ_SCOPES],
  [XERO_BUDGET_WRITE_SCOPE]: [XERO_BUDGET_READ_SCOPE],
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

  if (path.includes("/Journals")) return [XERO_JOURNALS_READ_SCOPE];
  if (path.includes("/Budgets")) {
    return write ? [XERO_BUDGET_WRITE_SCOPE] : [XERO_BUDGET_READ_SCOPE];
  }
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
      s === XERO_JOURNALS_READ_SCOPE
  );
  const reportsOrBudgets = missing.some(
    (s) => s.startsWith("accounting.reports.") || s.includes("budgets")
  );
  let extra = "";
  if (phase3) extra += " Enable “Extended APIs” before reconnecting.";
  if (reportsOrBudgets) extra += " Reconnect with “Full accounting scopes” for reports and budgets.";
  return (
    `OAuth token is missing scopes (${shown}${more}). ` +
    "Settings → Integrations → Disconnect Xero, then Connect again — token refresh alone does not add scopes." +
    extra
  );
}
