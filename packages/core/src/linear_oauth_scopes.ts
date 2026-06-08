export type LinearMode = "read_write" | "read_only";

const READ_SCOPES = ["read"] as const;
const WRITE_SCOPES = ["read", "write", "issues:create", "comments:create"] as const;

export function scopesForLinearMode(mode: LinearMode): string[] {
  return mode === "read_only" ? [...READ_SCOPES] : [...WRITE_SCOPES];
}

export const LINEAR_DEFAULT_MODE: LinearMode = "read_write";
