/** Score OAuth account emails for mailbox routing (no broker imports). */

export interface OAuthAccountRef {
  accountId: string;
  email?: string;
}

export function oauthMailboxQualityScore(email: string | undefined): number {
  if (!email?.trim()) return 0;
  const e = email.trim().toLowerCase();
  if (e.includes("#ext#")) return 5;
  if (e.endsWith("@gmail.com") || e.endsWith("@googlemail.com")) return 100;
  if (e.endsWith(".onmicrosoft.com")) return 15;
  if (e.includes("@")) return 70;
  return 10;
}

export function pickBestOAuthAccountByEmail<T extends OAuthAccountRef>(
  accounts: readonly T[]
): T | undefined {
  if (accounts.length === 0) return undefined;
  return [...accounts].sort(
    (a, b) => oauthMailboxQualityScore(b.email) - oauthMailboxQualityScore(a.email)
  )[0];
}
