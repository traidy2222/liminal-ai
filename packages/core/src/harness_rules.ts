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
  `- **R-ORCH-ID**: After spawn_agent, capture the returned task_id and pass it in task_ids to wait_for_agents.\n`;
