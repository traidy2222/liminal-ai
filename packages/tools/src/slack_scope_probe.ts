/**
 * Live Slack OAuth scope probe — auth.scopes.list vs harness expectations.
 */
import {
  getSlackAccessToken,
  listSlackOAuthAccounts,
  missingSlackScopes,
  scopesForSlackMode,
  SLACK_DEFAULT_MODE,
} from "@liminal/core";

const SLACK_API = "https://slack.com/api";

export type SlackScopeProbeResult =
  | { state: "ok"; scopeCount: number }
  | { state: "not_connected"; detail: string }
  | { state: "stale"; detail: string; missing: string[] }
  | { state: "error"; detail: string };

export function expectedSlackScopes(mode = SLACK_DEFAULT_MODE): string[] {
  return scopesForSlackMode(mode);
}

/** Compare live token scopes (auth.scopes.list) to harness read_write set. */
export async function probeSlackLiveScopes(): Promise<SlackScopeProbeResult> {
  const accounts = await listSlackOAuthAccounts();
  if (accounts.length === 0) {
    return { state: "not_connected", detail: "no Slack OAuth account on disk" };
  }
  const account = accounts[0]!;
  const token = await getSlackAccessToken(account.accountId);
  if (!token) {
    return { state: "not_connected", detail: "Slack token unreadable" };
  }

  try {
    const res = await fetch(`${SLACK_API}/auth.scopes.list`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      info?: Array<{ type?: string; scopes?: string[] }>;
    };
    if (!data.ok) {
      return { state: "error", detail: data.error ?? `HTTP ${res.status}` };
    }
    const userInfo = data.info?.find((i) => i.type === "user") ?? data.info?.[0];
    const live = userInfo?.scopes ?? [];
    const need = new Set(expectedSlackScopes());
    const missing = [...need].filter((s) => !live.includes(s));
    if (missing.length > 0) {
      return {
        state: "stale",
        detail: `token has ${live.length} scopes, harness needs ${need.size} (${missing.length} missing)`,
        missing,
      };
    }
    return { state: "ok", scopeCount: live.length };
  } catch (e) {
    return { state: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

export function formatSlackScopeProbeLine(probe: SlackScopeProbeResult): string {
  switch (probe.state) {
    case "ok":
      return `- Slack scopes: **live ok** (${probe.scopeCount} on token)`;
    case "not_connected":
      return `- Slack scopes: **no OAuth** — ${probe.detail}`;
    case "stale":
      return (
        `- Slack scopes: **stale token** — ${probe.detail}\n` +
        `  Missing: ${probe.missing.join(", ")}\n` +
        `  Fix: Settings → Integrations → Disconnect Slack → Connect (or connect_provider start_oauth).`
      );
    case "error":
      return `- Slack scopes: **probe failed** — ${probe.detail}`;
  }
}

/** Enrich Slack missing_scope API errors with reconnect guidance. */
export async function enrichSlackScopeError(
  data: Record<string, unknown>,
  accountHint?: string,
  httpStatus?: number
): Promise<string> {
  const err =
    typeof data.error === "string"
      ? data.error
      : httpStatus
        ? `Slack HTTP ${httpStatus}`
        : "Slack API error";
  if (err !== "missing_scope") return err;

  const needed = typeof data.needed === "string" ? data.needed.trim() : "";
  const accounts = await listSlackOAuthAccounts();
  const match = accountHint
    ? accounts.find(
        (a) =>
          a.accountId === accountHint ||
          a.teamName?.toLowerCase() === accountHint.toLowerCase()
      )
    : accounts[0];
  const staleOnDisk = missingSlackScopes(match?.scopes ?? [], SLACK_DEFAULT_MODE);

  const parts: string[] = [
    needed ? `missing_scope (Slack requires **${needed}** on this user token)` : "missing_scope",
  ];
  if (staleOnDisk.length > 0) {
    parts.push(`Reconnect Slack to add: ${staleOnDisk.join(", ")}`);
  } else {
    parts.push(
      "OAuth token predates new Slack tools — Disconnect + Connect Slack even if Integrations shows connected."
    );
  }
  parts.push('connect_provider({ provider: "slack", start_oauth: true })');
  return parts.join("\n");
}
