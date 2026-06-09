export type SlackMode = "read_write" | "read_only";

const READ_USER_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "users:read",
  "search:read",
] as const;

/** Write scopes for full Slack REST tool surface (conversations.open, files.upload, etc.). */
const WRITE_USER_SCOPES = [
  "chat:write",
  "reactions:write",
  "files:write:user",
  "im:write",
  "channels:write",
  "groups:write",
  "mpim:write",
] as const;

/** Either scope satisfies the requirement (Slack renamed files:write:user → files:write for some apps). */
const SLACK_SCOPE_SATISFIERS: Record<string, readonly string[]> = {
  "files:write:user": ["files:write:user", "files:write"],
  "files:write": ["files:write", "files:write:user"],
};

function grantedHasScope(granted: Set<string>, scope: string): boolean {
  if (granted.has(scope)) return true;
  const alts = SLACK_SCOPE_SATISFIERS[scope];
  return alts?.some((s) => granted.has(s)) ?? false;
}

export function scopesForSlackMode(mode: SlackMode): string[] {
  return mode === "read_only" ? [...READ_USER_SCOPES] : [...READ_USER_SCOPES, ...WRITE_USER_SCOPES];
}

/** Query params for Vireon hosted OAuth — explicit scope list (mode alone is insufficient). */
export function slackHostedConnectExtra(mode: SlackMode = SLACK_DEFAULT_MODE): Record<string, string> {
  return { scopes: scopesForSlackMode(mode).join(",") };
}

/** Scopes granted at connect time but missing after app scope expansion — user must reconnect Slack. */
export function missingSlackScopes(granted: string[], mode: SlackMode = "read_write"): string[] {
  const need = scopesForSlackMode(mode);
  const have = new Set(granted);
  return need.filter((s) => !grantedHasScope(have, s));
}

export const SLACK_DEFAULT_MODE: SlackMode = "read_write";
