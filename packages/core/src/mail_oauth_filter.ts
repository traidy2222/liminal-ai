/**
 * Mail-ready OAuth account filtering — ignore tokens without mail scopes or admin-only Entra guests.
 */
import { resolveGoogleServices } from "./connector_catalog.js";
import { resolveMicrosoftServices, type MicrosoftServicePreset } from "./microsoft_connector_catalog.js";
import { missingGoogleScopes } from "./google_oauth_scopes.js";
import { missingMicrosoftScopes } from "./microsoft_oauth_scopes.js";
import { listGoogleOAuthAccounts } from "./oauth_broker.js";
import { listMicrosoftOAuthAccounts } from "./microsoft_oauth_broker.js";
import type { OAuthAccountRef } from "./oauth_account_pick.js";

export interface MailOAuthAccount extends OAuthAccountRef {
  scopes: string[];
  expiresAt: number;
}

export function googleAccountHasMailScopes(scopes: readonly string[]): boolean {
  const gmailPresets = resolveGoogleServices(["gmail"]);
  if (missingGoogleScopes([...scopes], gmailPresets).length === 0) return true;
  return [...scopes].some((s) => /gmail\.(readonly|modify|compose)/i.test(s));
}

export function microsoftAccountHasMailScopes(scopes: readonly string[]): boolean {
  const [mail] = resolveMicrosoftServices(["mail"]);
  if (!mail) return false;
  const readInboxPreset: MicrosoftServicePreset = {
    ...mail,
    scopes: mail.readOnlyScopes,
  };
  return missingMicrosoftScopes([...scopes], [readInboxPreset]).length === 0;
}

/** Entra B2B guest UPNs are tenant admin logins, not day-to-day mailboxes. */
export function isEntraGuestMailbox(email: string | undefined): boolean {
  return !!email?.trim() && email.trim().toLowerCase().includes("#ext#");
}

export function filterGoogleMailAccounts<T extends { scopes: string[] }>(accounts: readonly T[]): T[] {
  return accounts.filter((a) => googleAccountHasMailScopes(a.scopes));
}

export function filterMicrosoftMailAccounts<T extends { scopes: string[]; email?: string }>(
  accounts: readonly T[],
  options?: { includeEntraGuest?: boolean }
): T[] {
  const includeGuest = options?.includeEntraGuest === true;
  return accounts.filter(
    (a) =>
      microsoftAccountHasMailScopes(a.scopes) && (includeGuest || !isEntraGuestMailbox(a.email))
  );
}

export async function listGoogleMailOAuthAccounts(): Promise<MailOAuthAccount[]> {
  const accounts = await listGoogleOAuthAccounts();
  return filterGoogleMailAccounts(accounts);
}

export async function listMicrosoftMailOAuthAccounts(): Promise<MailOAuthAccount[]> {
  const accounts = await listMicrosoftOAuthAccounts();
  return filterMicrosoftMailAccounts(accounts);
}

export async function listConnectedMailOAuthAccounts(): Promise<
  Array<MailOAuthAccount & { provider: "google" | "microsoft" }>
> {
  const [google, microsoft] = await Promise.all([
    listGoogleMailOAuthAccounts(),
    listMicrosoftMailOAuthAccounts(),
  ]);
  return [
    ...google.map((a) => ({ ...a, provider: "google" as const })),
    ...microsoft.map((a) => ({ ...a, provider: "microsoft" as const })),
  ];
}

export function formatConnectedMailboxesLine(
  accounts: ReadonlyArray<{ provider: "google" | "microsoft"; email?: string; accountId: string }>
): string {
  if (accounts.length === 0) {
    return "Connected mailboxes: (none — connect Google Gmail or Microsoft 365 mail in Settings)";
  }
  const parts = accounts.map((a) => {
    const label = a.provider === "google" ? "Gmail" : "Outlook";
    return `${label}:${a.email ?? a.accountId}`;
  });
  return `Connected mailboxes: ${parts.join(", ")}`;
}
