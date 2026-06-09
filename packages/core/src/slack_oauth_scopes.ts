/**
 * Slack user-token scopes for harness REST tools.
 * Canonical names match https://docs.slack.dev/reference/methods/* "User token" scopes.
 */
export type SlackMode = "read_write" | "read_only";

/** API method → user scopes (from Slack method docs). */
export const SLACK_API_METHOD_SCOPES: Readonly<Record<string, readonly string[]>> = {
  "conversations.list": ["channels:read", "groups:read", "im:read", "mpim:read"],
  "users.list": ["users:read"],
  "conversations.history": ["channels:history", "groups:history", "im:history", "mpim:history"],
  "conversations.replies": ["channels:history", "groups:history", "im:history", "mpim:history"],
  "search.messages": ["search:read"],
  "chat.postMessage": ["chat:write"],
  "reactions.add": ["reactions:write"],
  "conversations.open": ["channels:write", "groups:write", "im:write", "mpim:write"],
  "files.upload": ["files:write"],
  "files.getUploadURLExternal": ["files:write"],
  "files.completeUploadExternal": ["files:write"],
};

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

const WRITE_USER_SCOPES = [
  "chat:write",
  "reactions:write",
  "files:write",
  "im:write",
  "channels:write",
  "groups:write",
  "mpim:write",
] as const;

/**
 * Slack may grant legacy or granular :user scope names; either satisfies harness checks.
 * OAuth requests use canonical method-doc names in READ/WRITE lists above.
 */
const SLACK_SCOPE_SATISFIERS: Record<string, readonly string[]> = {
  "search:read": ["search:read", "search:read:user"],
  "search:read:user": ["search:read:user", "search:read"],
  "im:write": ["im:write", "im:write:user"],
  "im:write:user": ["im:write:user", "im:write"],
  "files:write": ["files:write", "files:write:user"],
  "files:write:user": ["files:write:user", "files:write"],
  "chat:write": ["chat:write", "chat:write:user"],
  "chat:write:user": ["chat:write:user", "chat:write"],
  "reactions:write": ["reactions:write", "reactions:write:user"],
  "reactions:write:user": ["reactions:write:user", "reactions:write"],
};

function grantedHasScope(granted: Set<string>, scope: string): boolean {
  if (granted.has(scope)) return true;
  const alts = SLACK_SCOPE_SATISFIERS[scope];
  return alts?.some((s) => granted.has(s)) ?? false;
}

export function scopesForSlackMode(mode: SlackMode): string[] {
  return mode === "read_only" ? [...READ_USER_SCOPES] : [...READ_USER_SCOPES, ...WRITE_USER_SCOPES];
}

/** Query params for Vireon hosted OAuth — Slack needs user_scope, not bot scope. */
export function slackHostedConnectExtra(mode: SlackMode = SLACK_DEFAULT_MODE): Record<string, string> {
  const userScopes = scopesForSlackMode(mode).join(",");
  return {
    user_scope: userScopes,
    scopes: userScopes,
  };
}

/** Scopes granted at connect time but missing after app scope expansion — user must reconnect Slack. */
export function missingSlackScopes(granted: string[], mode: SlackMode = "read_write"): string[] {
  const need = scopesForSlackMode(mode);
  const have = new Set(granted);
  return need.filter((s) => !grantedHasScope(have, s));
}

/** Union of all method-doc scopes used by harness Slack REST tools (read_write). */
export function slackRestToolScopeUnion(): string[] {
  const all = new Set<string>();
  for (const scopes of Object.values(SLACK_API_METHOD_SCOPES)) {
    for (const s of scopes) all.add(s);
  }
  return [...all].sort();
}

export const SLACK_DEFAULT_MODE: SlackMode = "read_write";
