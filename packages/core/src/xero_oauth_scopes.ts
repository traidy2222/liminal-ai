/**
 * Xero OAuth 2.0 scope presets for Liminal connectors.
 */
export type XeroMode = "read_write" | "read_only";

const IDENTITY = ["openid", "profile", "email", "offline_access"] as const;

/** Granular scopes (required for Xero apps created on/after 2026-03-02). */
const READ_SCOPES = [
  "accounting.invoices.read",
  "accounting.contacts.read",
  "accounting.settings.read",
] as const;

const WRITE_SCOPES = [
  "accounting.invoices",
  "accounting.contacts",
  "accounting.settings",
] as const;

export function scopesForXeroMode(mode: XeroMode): string[] {
  const accounting = mode === "read_only" ? [...READ_SCOPES] : [...WRITE_SCOPES];
  return [...IDENTITY, ...accounting];
}

export const XERO_DEFAULT_MODE: XeroMode = "read_write";
