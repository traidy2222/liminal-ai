import type { ToolResult } from "./types.js";

/**
 * Expected miss / user-fixable outcomes — not infrastructure failures.
 * These should not trip the per-tool circuit breaker.
 */
export function isRecoverableToolFailure(name: string, result: ToolResult): boolean {
  if (result.ok) return false;
  const err = result.error.toLowerCase();

  // A program exited unsuccessfully, but the execution tool is healthy. A new
  // script/offset/argument must remain runnable; the harness bounds repeated
  // equivalent failures separately from backend outages.
  if (name === "run_shell" && /^exit code -?\d+[.\s]/i.test(result.error)) return true;
  if (name === "execute_code" || name.startsWith("mcp_")) {
    try {
      const detail = JSON.parse(result.error);
      if (name === "execute_code" && Number.isInteger(detail.exit_code) &&
          typeof detail.timed_out === "boolean" && typeof detail.output_capped === "boolean") return true;
      if (name.startsWith("mcp_") && detail.error?.code === "capability_unavailable" &&
          detail.error?.category === "unsupported_provider" && detail.error?.retryable === false) return true;
    } catch { /* Unstructured infrastructure errors still count. */ }
  }

  if (name === "recall" && err.includes("no note found")) return true;
  if (name === "forget" && err.includes("no memory found")) return true;
  if (name === "read_file" && /(enoent|not found|does not exist|no such file)/.test(err)) {
    return true;
  }
  if (name === "vault_read" && /(not found|does not exist|enoent)/.test(err)) return true;

  return false;
}
