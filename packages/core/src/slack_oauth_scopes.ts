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

const WRITE_USER_SCOPES = ["chat:write", "reactions:write", "files:write", "im:write"] as const;

export function scopesForSlackMode(mode: SlackMode): string[] {
  return mode === "read_only" ? [...READ_USER_SCOPES] : [...READ_USER_SCOPES, ...WRITE_USER_SCOPES];
}

/** Scopes granted at connect time but missing after app scope expansion — user must reconnect Slack. */
export function missingSlackScopes(granted: string[], mode: SlackMode = "read_write"): string[] {
  const need = scopesForSlackMode(mode);
  const have = new Set(granted);
  return need.filter((s) => !have.has(s));
}

export const SLACK_DEFAULT_MODE: SlackMode = "read_write";
