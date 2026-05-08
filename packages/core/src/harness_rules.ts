/**
 * Harness-injected rule recall (core-only; avoids core → @liminal/tools import cycle).
 * Injected once per send() when entering round 2, unless AGENT_RULE_RECALL=0.
 */
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
  `- **R-USER-STANCE-EVIDENCE**: Do not assert user beliefs/preferences unless directly evidenced by the user's words in this session.\n` +
  `- **R-QUESTION-NOT-BELIEF**: User questions/probes are not commitments; avoid turning them into declared beliefs.\n` +
  `- **R-INFERENCE-LABEL**: If inferring user stance, mark it tentative and include confidence (low/med/high).\n`;
