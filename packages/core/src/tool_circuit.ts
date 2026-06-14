import type { ToolResult } from "./types.js";

/**
 * Expected miss / user-fixable outcomes — not infrastructure failures.
 * These should not trip the per-tool circuit breaker.
 */
export function isRecoverableToolFailure(name: string, result: ToolResult): boolean {
  if (result.ok) return false;
  const err = result.error.toLowerCase();

  if (name === "recall" && err.includes("no note found")) return true;
  if (name === "forget" && err.includes("no memory found")) return true;
  if (name === "read_file" && /(enoent|not found|does not exist|no such file)/.test(err)) {
    return true;
  }
  if (name === "vault_read" && /(not found|does not exist|enoent)/.test(err)) return true;

  return false;
}
