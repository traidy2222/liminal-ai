/**
 * Optional latency preset — trims sidecar LLM passes and first-turn gather cost.
 * Keys only apply when not explicitly set in process.env or harness prefs.
 */
export const LATENCY_MODE_ENV_PATCHES: Readonly<Record<string, string>> = {
  AGENT_WORLD_CONTEXT: "0",
  AGENT_INTENT_INFERENCE: "0",
  AGENT_INTENT_REPO_CONTEXT: "0",
  AGENT_REASONING_BUDGET: "0",
  /** Master proactive verify (browser hints, etc.) stays off; edit lint is decoupled — see agent.runProactiveVerificationAfterBatch. */
  AGENT_PROACTIVE_VERIFY: "0",
  /** Session JSONL stays on — required for chat transcript persistence across restarts. */
  AGENT_UI_VERBOSITY: "quiet",
  AGENT_OBSIDIAN_DISCOVER: "0",
  AGENT_EFFORT: "low",
  AGENT_RECIPE_LIBRARY: "0",
  /** Skips an extra tool-free completion when tools ran but chat text was short. */
  AGENT_USER_REPLY_FINALIZE: "0",
  /** Lower generation ceiling — faster tail on short tool turns (routing cap still wins when set). */
  AGENT_MAX_COMPLETION_TOKENS: "4000",
};

export function latencyModeEnabled(prefs: { harness?: { env?: Record<string, string> } } | null): boolean {
  const fromEnv = process.env["AGENT_LATENCY_MODE"]?.trim();
  if (fromEnv === "1" || fromEnv?.toLowerCase() === "true") return true;
  const fromPrefs = prefs?.harness?.env?.["AGENT_LATENCY_MODE"]?.trim();
  return fromPrefs === "1" || fromPrefs?.toLowerCase() === "true";
}

export function latencyModePatchForKey(
  key: string,
  prefs: { harness?: { env?: Record<string, string> } } | null
): string | undefined {
  if (!latencyModeEnabled(prefs)) return undefined;
  const patch = LATENCY_MODE_ENV_PATCHES[key];
  if (patch === undefined) return undefined;
  if (process.env[key]?.trim()) return undefined;
  if (prefs?.harness?.env?.[key]?.trim()) return undefined;
  return patch;
}
