/**
 * Xero OAuth 2.0 scope presets for Liminal connectors.
 */
export type XeroMode = "read_write" | "read_only";

const IDENTITY = ["openid", "profile", "email", "offline_access"] as const;

const READ_SCOPES = [
  "accounting.transactions.read",
  "accounting.contacts.read",
  "accounting.settings.read",
  "accounting.reports.read",
] as const;

const WRITE_SCOPES = [
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
] as const;

export function scopesForXeroMode(mode: XeroMode): string[] {
  const accounting = mode === "read_only" ? [...READ_SCOPES] : [...WRITE_SCOPES, "accounting.reports.read"];
  return [...IDENTITY, ...accounting];
}

export const XERO_DEFAULT_MODE: XeroMode = "read_write";
