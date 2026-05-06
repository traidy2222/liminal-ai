/**
 * Harness-injected rule recall (core-only; avoids core → @liminal/tools import cycle).
 * Injected once per send() when entering round 2, unless AGENT_RULE_RECALL=0.
 */
export const HARNESS_RULE_RECALL_MESSAGE =
  `[REMEMBER — named harness protocol rules]\n` +
  `- **R-PLAN-3STEPS**: If the user lists ≥3 explicit ordered steps, call plan() before executing tools for those steps.\n` +
  `- **R-SEQ-SETUP**: When the user numbers prerequisites (e.g. "1) remember … 2) remember … 3) memory_graph"), execute them in order — do not skip earlier steps.\n` +
  `- **R-CITE-PATHS**: If you used repo_map, read_file, or list_dir, your final reply must cite at least one real path string that appeared in tool output (not invented).\n` +
  `- **R-DISTILL-HANDOFF**: If tool output contains NEXT_ACTIONS_JSON with read_artifact.hash, call read_artifact with that hash before finishing.\n` +
  `- **R-ORCH-ID**: After spawn_agent, capture the returned task_id and pass it in task_ids to wait_for_agents.\n` +
  `- **R-CONTRACT-BOUNDS**: If a plan defines execution contract bounds (steps/time/tool budget), keep tool usage within those bounds or replan.\n` +
  `- **R-COMMITMENT-CHECK**: Before destructive or risky actions, ensure they do not violate explicit commitments/invariants.\n` +
  `- **R-SEARCH-DIVERSITY**: For the first research search pass, diversify intents (origins/background, latest status, impact/metrics) and avoid near-duplicate query wording.\n` +
  `- **R-ONE-SHOT-RETRY**: If a tool intent fails twice with near-identical args, stop retrying and replan with a different approach.\n` +
  `- **R-ACTIVE-FIRST**: Prefer the narrowest currently active tool first; activate only one new family when required by missing capability.\n` +
  `- **R-LIVE-DATA-HONESTY**: For live/current conditions claims, include source + observed/as-of time; if live data is unavailable, disclose fallback locality and uncertainty.\n` +
  `- **R-USER-STANCE-EVIDENCE**: Do not assert user beliefs/preferences unless directly evidenced by the user's words in this session.\n` +
  `- **R-QUESTION-NOT-BELIEF**: User questions/probes are not commitments; avoid turning them into declared beliefs.\n` +
  `- **R-INFERENCE-LABEL**: If inferring user stance, mark it tentative and include confidence (low/med/high).\n`;
