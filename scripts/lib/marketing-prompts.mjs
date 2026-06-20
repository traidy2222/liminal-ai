/**
 * Single source of truth for **live** and **desktop** marketing capture prompts.
 * Each run uses the real harness — prompts are chosen to surface distinctive tools.
 */

/** @typedef {{
 *   key: string;
 *   title: string;
 *   subtitle: string;
 *   prompt: string;
 *   maxWaitMs: number;
 *   accent: string;
 *   expectTools?: string[];
 * }} MarketingPromptBase */

/** @type {MarketingPromptBase[]} */
export const MARKETING_PROMPT_BASES = [
  {
    key: "code-ship-test",
    title: "Plan, ship, and verify code",
    subtitle:
      "plan → write_file → run_shell (node:test) — self-healing loop with every step visible in the harness.",
    prompt: `You are recording a marketing demo. Show how Liminal ships code with verification.
The marketing-capture/ folder was wiped clean for this run — all files are new.

1) Call plan() with exactly 3 steps: implement slugify, add tests, run tests.
2) Create marketing-capture/slugify.ts exporting slugify(input: string): string — lowercase, trim, collapse whitespace to single hyphens, strip characters outside [a-z0-9-].
3) Create marketing-capture/slugify.test.js using node:test (import test, assert from node:test / node:assert) with 3 cases: "Hello World" → "hello-world", leading/trailing spaces, punctuation stripped.
4) run_shell command "node --test marketing-capture/slugify.test.js" (do not use run_tests — use run_shell only).
If tests fail, fix with edit_file (not write_file create) and re-run once. End with PASS/FAIL and one example slugify("Foo Bar!") result.`,
    maxWaitMs: 600_000,
    accent: "#00ff88",
    expectTools: ["plan", "write_file", "run_shell", "think"],
  },
  {
    key: "repo-react-trace",
    title: "Map the repo, trace the ReAct loop",
    subtitle:
      "repo_map, grep_file, read_file_chunked — orient in a monorepo and explain how tool results close the loop.",
    prompt: `Read-only repo archaeology for a marketing capture — do not edit any files.

1) repo_map on packages/core/src with depth 2.
2) grep_file path packages/core/src/agent.ts pattern "class AgentHarness" — note the line number of the match.
3) read_file path packages/core/src/agent.ts offset=<that line minus 5> limit=120 line_numbers true — inspect how a turn dispatches tools and consumes results.
4) In exactly 4 bullets, explain the ReAct loop as implemented here: user message → model tool calls → tool results → next model turn → turn_end.`,
    maxWaitMs: 360_000,
    accent: "#00d4ff",
    expectTools: ["repo_map", "grep_file", "read_file", "think"],
  },
  {
    key: "memory-recall",
    title: "Memory that survives the session",
    subtitle:
      "remember, recall_relevant, memory_stats — typed notes with hybrid retrieval, not chat context amnesia.",
    prompt: `Demonstrate persistent memory (marketing capture — safe to write this note):

1) remember key "marketing:capture-policy" value "Liminal marketing videos must be recorded from real harness runs with session.jsonl proof — never fixture UI." type fact scope workspace
2) recall_relevant query "marketing session jsonl proof" k 5
3) memory_stats

Reply in 3 short bullets: the stored value, the top recall_relevant hit text, and total note count from memory_stats.`,
    maxWaitMs: 300_000,
    accent: "#ff4488",
    expectTools: ["remember", "recall_relevant", "memory_stats"],
  },
  {
    key: "web-research-cite",
    title: "Research with receipts",
    subtitle:
      "web_search + web_fetch — cite primary docs with URLs and concrete API field names from the source.",
    prompt: `Research task for marketing footage:

1) web_search for OpenRouter prompt caching cache_control (official docs first).
2) web_fetch the best official OpenRouter documentation URL from results (not a forum post).
3) Answer in exactly 3 bullets. Each bullet must include: a full https URL you fetched, and one exact parameter or JSON field name for caching copied from that page (e.g. cache_control). Max 90 words total.`,
    maxWaitMs: 540_000,
    accent: "#cc88ff",
    expectTools: ["web_search", "web_fetch"],
  },
  {
    key: "harness-test-run",
    title: "Find code, run the test suite",
    subtitle:
      "ast_grep, find_files, run_tests — code intelligence and verification on the real @liminal/core package.",
    prompt: `Read-only verification demo:

1) ast_grep under packages/core for "export class AgentHarness" (TypeScript). Report the file path of the first match.
2) find_files pattern "**/*agent*.test.ts" under packages/core — pick one file that tests the harness/agent.
3) run_tests scoped to that single file only.

Reply with: test file path, pass/fail, and test count if shown. Do not edit any source files.`,
    maxWaitMs: 720_000,
    accent: "#ffb347",
    expectTools: ["ast_grep", "find_files", "run_tests"],
  },
];

/** Back-compat for docs / old capture IDs */
export const LEGACY_PROMPT_IDS = {
  "live-coding-debounce": "live-code-ship-test",
  "live-repo-grep": "live-repo-react-trace",
  "live-git-status": "live-memory-recall",
  "live-web-research": "live-web-research-cite",
  "live-read-tests": "live-harness-test-run",
  "desktop-coding-debounce": "desktop-code-ship-test",
  "desktop-repo-grep": "desktop-repo-react-trace",
  "desktop-git-status": "desktop-memory-recall",
  "desktop-web-research": "desktop-web-research-cite",
};

/**
 * @param {"live" | "desktop"} channel
 * @param {boolean} [includeOptional=false] — 5th prompt (run_tests); slower but shows code_intel
 */
export function getMarketingPrompts(channel, includeOptional = false) {
  const bases = includeOptional
    ? MARKETING_PROMPT_BASES
    : MARKETING_PROMPT_BASES.filter((p) => p.key !== "harness-test-run");

  return bases.map((base) => ({
    ...base,
    id: `${channel}-${base.key}`,
  }));
}

/**
 * @param {string} id
 * @param {"live" | "desktop"} channel
 */
export function resolvePromptId(id, channel) {
  const resolved = LEGACY_PROMPT_IDS[id] ?? id;
  const prompts = getMarketingPrompts(channel, true);
  if (prompts.some((p) => p.id === resolved)) return resolved;
  return id;
}

/**
 * @param {string} id
 * @param {"live" | "desktop"} channel
 * @param {boolean} [includeOptional]
 */
export function findPrompt(id, channel, includeOptional = false) {
  const resolved = resolvePromptId(id, channel);
  const all = getMarketingPrompts(channel, includeOptional);
  const optional = getMarketingPrompts(channel, true);
  return all.find((p) => p.id === resolved) ?? optional.find((p) => p.id === resolved) ?? null;
}
