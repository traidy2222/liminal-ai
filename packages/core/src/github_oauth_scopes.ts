/** GitHub OAuth scopes for hosted connect + MCP (classic PAT-style scopes). */

export type GithubMode = "read_write" | "read_only";

const READ_WRITE_SCOPES = ["repo", "read:org", "read:user", "read:packages"] as const;
const READ_ONLY_SCOPES = ["public_repo", "read:org", "read:user"] as const;

export function scopesForGithubMode(mode: GithubMode): string[] {
  return mode === "read_only" ? [...READ_ONLY_SCOPES] : [...READ_WRITE_SCOPES];
}
