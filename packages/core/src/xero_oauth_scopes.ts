/**
 * Xero OAuth 2.0 scope presets for Liminal connectors.
 *
 * Granular scopes (apps created on/after 2026-03-02): read and write are separate —
 * `read_write` mode requests both `.read` and write scopes. Keep in sync with
 * vireondynamics-website `src/lib/connect/xero-oauth.ts`.
 */
export type XeroMode = "read_write" | "read_only";

const IDENTITY = ["openid", "profile", "email", "offline_access"] as const;

/** Granular read scopes (required for Xero apps created on/after 2026-03-02). */
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

/** Granular write scopes (create/update/delete for those resource types). */
export const XERO_WRITE_SCOPES = [
  "accounting.invoices",
  "accounting.contacts",
  "accounting.settings",
  "accounting.payments",
  "accounting.banktransactions",
  "accounting.manualjournals",
  "accounting.attachments",
] as const;

/** Phase 3 — GL journals, Files, Projects, Payroll (separate API bases). */
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

export function scopesForXeroMode(mode: XeroMode): string[] {
  if (mode === "read_only") {
    return [...IDENTITY, ...XERO_READ_SCOPES, ...XERO_PHASE3_READ_SCOPES];
  }
  const scopeSet = new Set<string>([
    ...XERO_READ_SCOPES,
    ...XERO_WRITE_SCOPES,
    ...XERO_PHASE3_READ_SCOPES,
    ...XERO_PHASE3_WRITE_SCOPES,
  ]);
  return [...IDENTITY, ...scopeSet];
}

export const XERO_DEFAULT_MODE: XeroMode = "read_write";

/** Scopes required for accounting-only tools (identity excluded). */
export const XERO_FULL_ACCOUNTING_SCOPES: readonly string[] = [
  ...new Set([...XERO_READ_SCOPES, ...XERO_WRITE_SCOPES]),
];

/** All non-identity scopes for the full Liminal Xero toolset. */
export const XERO_FULL_SCOPES: readonly string[] = [
  ...new Set([
    ...XERO_READ_SCOPES,
    ...XERO_WRITE_SCOPES,
    ...XERO_PHASE3_READ_SCOPES,
    ...XERO_PHASE3_WRITE_SCOPES,
  ]),
];

/**
 * Pre-2026-03-02 monolithic scopes that imply granular scopes on tokens issued
 * before the migration. Used only for missing-scope detection / reconnect hints.
 */
const LEGACY_SCOPE_IMPLIES: Readonly<Record<string, readonly string[]>> = {
  "accounting.transactions.read": [
    "accounting.invoices.read",
    "accounting.payments.read",
    "accounting.banktransactions.read",
    "accounting.attachments.read",
  ],
  "accounting.transactions": [
    "accounting.invoices",
    "accounting.payments",
    "accounting.banktransactions",
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

export function xeroBundleMissingScopes(granted: string[] | undefined): string[] {
  const have = new Set((granted ?? []).map((s) => s.trim()).filter(Boolean));
  return XERO_FULL_SCOPES.filter((s) => !scopeSatisfied(s, have));
}

/** Phase 3 scopes missing from the token (files, projects, payroll, GL journals). */
export function xeroBundleMissingPhase3Scopes(granted: string[] | undefined): string[] {
  const have = new Set((granted ?? []).map((s) => s.trim()).filter(Boolean));
  const phase3 = [...new Set([...XERO_PHASE3_READ_SCOPES, ...XERO_PHASE3_WRITE_SCOPES])];
  return phase3.filter((s) => !scopeSatisfied(s, have));
}
