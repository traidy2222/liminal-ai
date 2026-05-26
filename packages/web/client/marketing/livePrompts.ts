/**
 * Prompts for **live** marketing capture (`npm run marketing:capture:live`).
 * Only user text — harness output comes from real tool runs.
 */
export interface LiveMarketingPrompt {
  id: string;
  title: string;
  /** Sent to POST /api/message */
  prompt: string;
  /** Skip if harness cannot complete (documented in manifest). */
  notes?: string;
  /** Auto-approve destructive tools when approval modal appears. */
  autoApprove?: boolean;
  freshContext?: boolean;
  maxWaitMs?: number;
}

export const LIVE_MARKETING_PROMPTS: LiveMarketingPrompt[] = [
  {
    id: "live-coding-debounce",
    title: "TypeScript debounce + tsc",
    prompt:
      "Write a well-typed TypeScript `debounce` function in `marketing-capture/debounce.ts` (create the folder), then run `npx tsc --noEmit` on that file only and explain in two sentences how it works.",
    maxWaitMs: 600_000,
  },
  {
    id: "live-repo-grep",
    title: "Repo exploration",
    prompt:
      "Use grep and read_file to find where `AgentHarness` is defined, list the top 3 files involved, and summarize the ReAct loop in 3 bullet points. Do not edit any files.",
    maxWaitMs: 480_000,
  },
  {
    id: "live-web-research",
    title: "Web research",
    prompt:
      "Use web_search then web_fetch on primary docs: what is OpenRouter prompt caching (`cache_control`)? Reply in 3 bullets with URLs.",
    maxWaitMs: 600_000,
  },
  {
    id: "live-git-status",
    title: "Git status summary",
    prompt:
      "Run git_status and git_diff --stat. Summarize what is modified in this repo in 2–3 sentences. Do not commit.",
    maxWaitMs: 300_000,
  },
  {
    id: "live-read-tests",
    title: "Read + run one test file",
    prompt:
      "Find one `*.test.ts` file under `packages/core`, run_tests scoped to it, and report pass/fail with the test file path.",
    maxWaitMs: 600_000,
  },
];
