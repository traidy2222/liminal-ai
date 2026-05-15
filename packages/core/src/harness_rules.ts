/**
 * Harness-injected rule recall (core-only; avoids core → @liminal/tools import cycle).
 * Injected once per send() when entering round 2, unless AGENT_RULE_RECALL=0.
 *
 * Rule recall lists **rule IDs only**; canonical wording lives in the tools package
 * system protocol (`## Named rules`). `buildHarnessRuleRecallMessage()` sorts IDs by
 * violation counts from `.agent_rule_stats.json` when stats exist.
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
  "R-WRITE-ONE-VERIFY":
    "After write_file succeeds with on-disk verification, at most one short read_file sanity check—then answer. No multi-pass full reads, grep fishing for closing tags on fresh writes, or ad-hoc shell syntax validators unless the user asked or a tool failed.",
  "R-DEDUP-TOOLS":
    "Within one send, do not repeat the same retrieval or read with identical or trivially narrower args (memory_query, recall_relevant, read_file on the same path, web_fetch on the same URL). Use the first result set; if it was empty or wrong, change the query meaningfully once, then synthesize.",
  "R-CLOSED-ARTIFACT":
    "For HTML/SVG/XML or other parseables: the first write_file must be a valid minimal document (balanced tags; no half-open script/style blocks). Prefer one complete file, or a tiny runnable skeleton plus apply_diff/patch_file hunks—never a truncated page that needs rescue rewrites.",
  "R-READ-TOOL-ERRORS":
    "When a tool fails with explicit remediation (e.g. edit_file needs overwrite:true; write_file refused because path exists), follow that instruction on the next call—do not cycle tools repeating the same failure mode.",
  "R-SYNTAX-COLUMN":
    "For SyntaxError (path:line:column), anchor diagnosis on that column on that physical line—count characters from line start. Do not relabel valid key:value object properties as typos without verifying the exact character at COLUMN. Never emit edit_file replacements where search and replace strings are identical.",
  "R-RESEARCH-BUDGET": "After gathering 3–4 substantive web sources, stop fetching and synthesize — do not keep fetching more sources on the same angle. Prefer web_research for broad queries instead of manual parallel search+fetch loops.",
  "R-SYNTHESIZE-VARY": "In final briefings and summaries, introduce each major theme once; do not repeat the same proper noun, date, or key concept in consecutive sections.",
  "R-MEMORY-SCOPE": "Recalled memory provides background context only. For research tasks on a new topic, do not let prior session topics bias search query construction — build queries from the current ask.",
  "R-EXPLORATORY-SYNTHESIS":
    "For open-ended or hypothetical ideation, answer the literal prompt with novel options first. Do not default the arc to the user's stored business roadmap, cashflow, or quit-job plan unless they explicitly tied this turn to that work.",
  "R-MEMORY-FIRST-IDENTITY": "For identity/personal prompts (name, who am I, what should you call me), check memory first and do not default to OS username from world context.",
  "R-RUNTIME-PERSONA-TOOLS":
    "If the user asks to change humor %, formality, confidence, verbosity, or persona strength, call set_runtime_settings with persona_controls — do not claim new dial values from chat text alone. Full persona swap → set_persona.",
  "R-ONE-SHOT-RETRY": "If a tool intent fails twice with near-identical args, stop retrying and replan with a different approach.",
  "R-ACTIVE-FIRST": "Prefer the narrowest currently active tool first; activate only one new family when required by missing capability.",
  "R-LIVE-DATA-HONESTY": "For live/current conditions claims, include source + observed/as-of time; if live data is unavailable, disclose fallback locality and uncertainty.",
  "R-SOURCE-TIER": "Match citation language to source credibility: T1 (Reuters/AP/gov) = state directly or 'Reuters reports…'; T2 (quality press/think tanks) = 'According to [outlet]…'; T3 (Wikipedia/aggregators) = 'Reports suggest…' or 'Background context…'; T4 (blogs/unknown) = 'Unverified claims suggest…' or omit. Never flatten all sources to the same confidence level.",
  "R-CONTRADICT-SURFACE": "When research sources disagree on a key fact, surface the contradiction explicitly — name both sides — rather than averaging or silently picking one. Use 'Sources conflict: [A says X, B says Y]' framing.",
  "R-ADVERSARIAL-CHECK": "After synthesizing research with ≥3 sources on any factual or analytical topic: run think() with adversarial lens — identify the 2-3 weakest claims, flag what relies only on T3/T4 sources, and note plausible alternative interpretations the synthesis may have missed.",
  "R-TYPECHECK-VERIFY": "After editing typed code (TypeScript, Python with annotations, etc.), run the project's typecheck or build command before claiming the fix is complete — do not assume types pass from visual inspection alone.",
  "R-SCOPE-CREEP": "Fix only what was explicitly requested. Do not refactor surrounding code, add unasked features, introduce new abstractions, or clean up adjacent issues — a bug fix is not a refactoring invitation.",
  "R-GREP-BEFORE-REFACTOR": "Before renaming a symbol, changing a function signature, or moving a type, grep for all call sites and import paths first — never assume a change is local without verifying all references.",
  "R-OUTPUT-TYPOGRAPHY":
    "User-visible replies are final copy: no long runs of hyphens as separators or underlines; at most one standalone markdown --- hr if needed. Use em dash (—) sparingly; prefer commas/periods/colons. Fix broken markdown before sending.",
  "R-MULTI-PART-USER":
    "If the user packs several distinct questions or requirements in one message, answer or explicitly defer each part in the final reply — do not silently skip a sub-question.",
};

/**
 * Compact harness rule recall: lists rule IDs only. Full definitions live in the
 * tools package system protocol under `## Named rules` — avoids duplicating long
 * paragraphs here (token savings, single source of truth).
 *
 * When `hitCounts` is non-empty, IDs are sorted by violation count (highest first).
 */
export function buildHarnessRuleRecallMessage(hitCounts: Map<string, number>): string {
  const allIds = Object.keys(HARNESS_RULES);
  const ordered =
    hitCounts.size > 0
      ? [...allIds].sort((a, b) => (hitCounts.get(b) ?? 0) - (hitCounts.get(a) ?? 0))
      : [...allIds];
  const lines = ordered.map((id) => `- **${id}**`);
  return (
    `[REMEMBER — harness protocol rule IDs. Full text for each ID is under "## Named rules" in the fixed system message — use that section as the canonical definition.]\n` +
    lines.join("\n") +
    `\n`
  );
}

/**
 * @param _topN Ignored (kept for signature compatibility); all IDs are always listed compactly.
 * @deprecated Prefer `buildHarnessRuleRecallMessage`.
 */
export function buildAdaptiveRuleMessage(_topN: number, hitCounts: Map<string, number>): string {
  return buildHarnessRuleRecallMessage(hitCounts);
}

/** @deprecated Prefer `buildHarnessRuleRecallMessage(new Map())`. */
export const HARNESS_RULE_RECALL_MESSAGE = buildHarnessRuleRecallMessage(new Map());
