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
] as const;

const WRITE_USER_SCOPES = ["chat:write"] as const;

export function scopesForSlackMode(mode: SlackMode): string[] {
  return mode === "read_only" ? [...READ_USER_SCOPES] : [...READ_USER_SCOPES, ...WRITE_USER_SCOPES];
}

export const SLACK_DEFAULT_MODE: SlackMode = "read_write";
