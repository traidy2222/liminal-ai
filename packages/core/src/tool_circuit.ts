import type { ToolResult } from "./types.js";

/**
 * Expected miss / user-fixable outcomes — not infrastructure failures.
 * These should not trip the per-tool circuit breaker.
 */
export function isRecoverableToolFailure(name: string, result: ToolResult): boolean {
  if (result.ok) return false;
  const err = result.error.toLowerCase().split("\naction_progress:")[0]!;
  if(name==='browser_credentials'&&/account_evidence_(?:required|mismatch)|record_account requires|account evidence was not found|is not a current password input|must be an e-number/.test(err))return true;
  // A stale/unsuitable puzzle observation needs correction, not a service outage
  // cooldown. Provider, account/balance and transport errors retain the circuit.
  if (name.startsWith('captcha_') && !/http \d|econn|network|timeout|timed out|zero_balance|key.*(?:invalid|not set)|browser has been closed|target.*closed|crash/.test(err) &&
      /visible_visual_challenge|visual_challenge_changed|invalid_visual_solution|unknown visual ref|source_region must|visual target is|visual challenge is still changing|no paid task submitted|solver destination is outside|solver coordinates lie outside/.test(err)) return true;
  // Bad browser arguments, stale DOM refs and unavailable selectors are a
  // correction/observation problem, not a browser backend outage.
  if (name.startsWith("browser_") && /no_progress|unknown (?:action op|ref|(?:browser )?session)|each action needs|pass `actions`|wait_ms:|select_option_ref:|timeout waiting for url|locator\.(?:click|fill|clear|selectoption|waitfor):|browser_act step/.test(err) &&
      !/browser has been closed|target.*closed|connection.*closed|crash/.test(err)) return true;

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
