/**
 * Pick a primary mailbox when Google and Microsoft OAuth are both connected.
 */
import { listGoogleOAuthAccounts } from "./oauth_broker.js";
import { listMicrosoftOAuthAccounts } from "./microsoft_oauth_broker.js";
import {
  oauthMailboxQualityScore,
  pickBestOAuthAccountByEmail,
} from "./oauth_account_pick.js";

export type MailProviderId = "google" | "microsoft";

export {
  oauthMailboxQualityScore,
  pickBestOAuthAccountByEmail,
} from "./oauth_account_pick.js";
export type { OAuthAccountRef } from "./oauth_account_pick.js";

export function resolveMailProviderFromEnv(): MailProviderId | "auto" {
  const raw = process.env.AGENT_MAIL_PROVIDER?.trim().toLowerCase();
  if (raw === "google" || raw === "gmail") return "google";
  if (raw === "microsoft" || raw === "outlook" || raw === "m365") return "microsoft";
  return "auto";
}

export interface PreferredMailRoute {
  provider: MailProviderId;
  accountId: string;
  email?: string;
  reason: string;
}

export async function resolvePreferredMailProvider(): Promise<PreferredMailRoute | null> {
  const forced = resolveMailProviderFromEnv();
  const google = await listGoogleOAuthAccounts();
  const microsoft = await listMicrosoftOAuthAccounts();

  if (forced !== "auto") {
    const pool = forced === "google" ? google : microsoft;
    const best = pickBestOAuthAccountByEmail(pool);
    if (!best) return null;
    return {
      provider: forced,
      accountId: best.accountId,
      email: best.email,
      reason: `AGENT_MAIL_PROVIDER=${forced}`,
    };
  }

  const bestGoogle = pickBestOAuthAccountByEmail(google);
  const bestMicrosoft = pickBestOAuthAccountByEmail(microsoft);
  const googleScore = oauthMailboxQualityScore(bestGoogle?.email);
  const microsoftScore = oauthMailboxQualityScore(bestMicrosoft?.email);

  if (!bestGoogle && !bestMicrosoft) return null;
  if (bestGoogle && (!bestMicrosoft || googleScore >= microsoftScore)) {
    const reason =
      googleScore > microsoftScore
        ? "Gmail/workspace mailbox outranks Microsoft guest or onmicrosoft.com account"
        : "Google OAuth present — default mail path is Gmail";
    return {
      provider: "google",
      accountId: bestGoogle.accountId,
      email: bestGoogle.email,
      reason,
    };
  }
  return {
    provider: "microsoft",
    accountId: bestMicrosoft!.accountId,
    email: bestMicrosoft!.email,
    reason: "Microsoft mailbox preferred by email quality score",
  };
}

export function formatPreferredMailRouteLine(route: PreferredMailRoute | null): string {
  if (!route) return "Primary mail: (none — connect Google or Microsoft OAuth)";
  const tools =
    route.provider === "google"
      ? "mcp_google_gmail_* / gmail_send_message / gmail_create_draft"
      : "mcp_microsoft_* mail tools / outlook_send_message / outlook_create_draft";
  return (
    `Primary mail: ${route.provider} → ${route.email ?? route.accountId} ` +
    `(use ${tools}). ${route.reason}.`
  );
}
