/**
 * Harness-injected rule recall (core-only; avoids core → @liminal/tools import cycle).
 * Injected once per send() when entering round 2, unless AGENT_RULE_RECALL=0.
 *
 * Adaptive injection: buildAdaptiveRuleMessage() selects the top-N most-violated rules
 * from live rule stats, so the model focuses on the rules it chronically ignores.
 */

/** Individual rule entries keyed by ID for selective injection. */
export const HARNESS_RULES: Record<string, string> = {
  "R-PLAN-3STEPS": "If the user lists ≥3 explicit ordered steps, call plan() before executing tools for those steps.",
  "R-SEQ-SETUP": "When the user numbers prerequisites (e.g. \"1) remember … 2) remember … 3) memory_graph\"), execute them in order — do not skip earlier steps.",
  "R-CITE-PATHS": "If you used repo_map, read_file, or list_dir, your final reply must cite at least one real path string that appeared in tool output (not invented).",
  "R-ORCH-ID": "After spawn_agent, capture the returned task_id and pass it in task_ids to wait_for_agents.",
  "R-SPAWN-PROMPT": "Every spawn_agent call must include system_prompt (role + constraints + output format) and user_prompt (full detailed task). A bare goal= only produces a cold, generic sub-agent with no output contract.",
  "R-CONTRACT-BOUNDS": "If a plan defines execution contract bounds (steps/time/tool budget), keep tool usage within those bounds or replan.",
  "R-COMMITMENT-CHECK": "Before destructive or risky actions, ensure they do not violate explicit commitments/invariants.",
  "R-SEARCH-DIVERSITY": "For the first research search pass, cover at least three distinct intents — diversify angle and phrasing rather than repeating the same question. What those intents are depends on the task.",
  "R-CHUNK-LARGE-FILES": "For very large files (full applications, >2000 lines), write in logical self-contained sections using multiple write_file calls (append mode) — provider streaming timeouts cut off multi-minute completions. Files up to ~1000 lines are fine in one call.",
  "R-LARGE-READ-DISCIPLINE": "Do not repeatedly full-read the same large file. After one full read, switch to read_file_chunked/file_metadata and targeted checks.",
  "R-RESEARCH-BUDGET": "After gathering 3–4 substantive web sources, stop fetching and synthesize — do not keep fetching more sources on the same angle. Prefer web_research for broad queries instead of manual parallel search+fetch loops.",
  "R-SYNTHESIZE-VARY": "In final briefings and summaries, introduce each major theme once; do not repeat the same proper noun, date, or key concept in consecutive sections.",
  "R-MEMORY-SCOPE": "Recalled memory provides background context only. For research tasks on a new topic, do not let prior session topics bias search query construction — build queries from the current ask.",
  "R-MEMORY-FIRST-IDENTITY": "For identity/personal prompts (name, who am I, what should you call me), check memory first and do not default to OS username from world context.",
  "R-ONE-SHOT-RETRY": "If a tool intent fails twice with near-identical args, stop retrying and replan with a different approach.",
  "R-ACTIVE-FIRST": "Prefer the narrowest currently active tool first; activate only one new family when required by missing capability.",
  "R-LIVE-DATA-HONESTY": "For live/current conditions claims, include source + observed/as-of time; if live data is unavailable, disclose fallback locality and uncertainty.",
  "R-SOURCE-TIER": "Match citation language to source credibility: T1 (Reuters/AP/gov) = state directly or 'Reuters reports…'; T2 (quality press/think tanks) = 'According to [outlet]…'; T3 (Wikipedia/aggregators) = 'Reports suggest…' or 'Background context…'; T4 (blogs/unknown) = 'Unverified claims suggest…' or omit. Never flatten all sources to the same confidence level.",
  "R-CONTRADICT-SURFACE": "When research sources disagree on a key fact, surface the contradiction explicitly — name both sides — rather than averaging or silently picking one. Use 'Sources conflict: [A says X, B says Y]' framing.",
  "R-ADVERSARIAL-CHECK": "After synthesizing research with ≥3 sources on any factual or analytical topic: run think() with adversarial lens — identify the 2-3 weakest claims, flag what relies only on T3/T4 sources, and note plausible alternative interpretations the synthesis may have missed.",
};

/**
 * Build a targeted rule recall message using hit counts from rule_stats.
 * Injects all rules on first call (round 2), then only the top-N most-violated
 * rules on subsequent rounds so chronic violators get extra reinforcement.
 *
 * @param topN   Max rules to include (0 = all)
 * @param hitCounts  Map of ruleId → hitCount from rule_stats (higher = more violations)
 */
export function buildAdaptiveRuleMessage(
  topN: number,
  hitCounts: Map<string, number>
): string {
  const allIds = Object.keys(HARNESS_RULES);
  let selected: string[];

  if (topN <= 0 || hitCounts.size === 0) {
    selected = allIds;
  } else {
    // Sort by violation count descending; zero-hit rules go last (still included up to topN)
    selected = [...allIds].sort((a, b) => {
      return (hitCounts.get(b) ?? 0) - (hitCounts.get(a) ?? 0);
    }).slice(0, topN);
  }

  const lines = selected.map((id) => `- **${id}**: ${HARNESS_RULES[id]}`);
  return `[REMEMBER — harness protocol rules (adaptive selection — most violated first)]\n${lines.join("\n")}\n`;
}

export const HARNESS_RULE_RECALL_MESSAGE =
  `[REMEMBER — named harness protocol rules]\n` +
  `- **R-PLAN-3STEPS**: If the user lists ≥3 explicit ordered steps, call plan() before executing tools for those steps.\n` +
  `- **R-SEQ-SETUP**: When the user numbers prerequisites (e.g. "1) remember … 2) remember … 3) memory_graph"), execute them in order — do not skip earlier steps.\n` +
  `- **R-CITE-PATHS**: If you used repo_map, read_file, or list_dir, your final reply must cite at least one real path string that appeared in tool output (not invented).\n` +
  `- **R-ORCH-ID**: After spawn_agent, capture the returned task_id and pass it in task_ids to wait_for_agents.\n` +
  `- **R-SPAWN-PROMPT**: Every spawn_agent call must include system_prompt (role + constraints + output format) and user_prompt (full detailed task). A bare goal= only produces a cold, generic sub-agent with no output contract.\n` +
  `- **R-CONTRACT-BOUNDS**: If a plan defines execution contract bounds (steps/time/tool budget), keep tool usage within those bounds or replan.\n` +
  `- **R-COMMITMENT-CHECK**: Before destructive or risky actions, ensure they do not violate explicit commitments/invariants.\n` +
  `- **R-SEARCH-DIVERSITY**: For the first research search pass, cover at least three distinct intents — diversify angle and phrasing rather than repeating the same question. What those intents are depends on the task.\n` +
  `- **R-CHUNK-LARGE-FILES**: For very large files (full applications, >2000 lines), write in logical self-contained sections using multiple write_file calls (append mode) — provider streaming timeouts cut off multi-minute completions. Files up to ~1000 lines are fine in one call.\n` +
  `- **R-LARGE-READ-DISCIPLINE**: Do not repeatedly full-read the same large file. After one full read, switch to read_file_chunked/file_metadata and targeted checks.\n` +
  `- **R-RESEARCH-BUDGET**: After gathering 3–4 substantive web sources, stop fetching and synthesize — do not keep fetching more sources on the same angle. Prefer web_research for broad queries instead of manual parallel search+fetch loops.\n` +
  `- **R-SYNTHESIZE-VARY**: In final briefings and summaries, introduce each major theme once; do not repeat the same proper noun, date, or key concept in consecutive sections.\n` +
  `- **R-MEMORY-SCOPE**: Recalled memory provides background context only. For research tasks on a new topic, do not let prior session topics bias search query construction — build queries from the current ask.\n` +
  `- **R-MEMORY-FIRST-IDENTITY**: For identity/personal prompts (name, who am I, what should you call me), check memory first and do not default to OS username from world context.\n` +
  `- **R-ONE-SHOT-RETRY**: If a tool intent fails twice with near-identical args, stop retrying and replan with a different approach.\n` +
  `- **R-ACTIVE-FIRST**: Prefer the narrowest currently active tool first; activate only one new family when required by missing capability.\n` +
  `- **R-LIVE-DATA-HONESTY**: For live/current conditions claims, include source + observed/as-of time; if live data is unavailable, disclose fallback locality and uncertainty.\n` +
  `- **R-SOURCE-TIER**: Match citation language to source tier: T1 (wire/gov/institution) = state directly; T2 (quality press) = 'According to [outlet]'; T3 (Wikipedia/aggregator) = 'Reports suggest'; T4 (unverified) = 'Unverified claims suggest' or omit.\n` +
  `- **R-CONTRADICT-SURFACE**: When sources disagree, name both sides explicitly — never silently average conflicting facts.\n` +
  `- **R-ADVERSARIAL-CHECK**: After synthesizing ≥3 sources on any factual or analytical topic, use think() to identify weak claims, T3/T4-only assertions, and missed alternative interpretations.\n`;
