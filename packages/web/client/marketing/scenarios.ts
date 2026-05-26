/**
 * **Illustrative fixtures only** — hand-authored UI states for layout / GIF timing.
 * They do NOT reflect a real harness run. For accurate marketing assets use:
 *   npm run marketing:capture:live
 * Recordings are replayed via `?recording=<id>` (see `MarketingApp.tsx`).
 */
import type { MessageEntry } from "../useSSE.js";
import type { PersonaUiThemeV2 } from "@liminal/core/persona-ui-theme";
import { DEFAULT_PERSONA_UI_THEME } from "@liminal/core/persona-ui-theme";

export type MarketingOverlay = "none" | "approval" | "persona-bootstrap";

export interface MarketingScenario {
  id: string;
  title: string;
  description: string;
  /** Progressive frames for GIF capture (last frame = hero PNG). */
  frames: MessageEntry[][];
  theme?: PersonaUiThemeV2;
  displayLabel?: string;
  personaName?: string;
  overlay?: MarketingOverlay;
  contextPct?: number;
  busy?: boolean;
  orbState?: "idle" | "thinking" | "running";
  inputPlaceholder?: string;
}

const T0 = 1_700_000_000_000;

function tc(
  id: string,
  name: string,
  status: "streaming" | "pending_approval" | "running" | "done" | "error",
  argsJson: string,
  offsetMs = 0
): Extract<MessageEntry, { kind: "tool_call" }> {
  const startedAt = T0 + offsetMs;
  return {
    kind: "tool_call",
    callId: id,
    name,
    argsJson,
    status,
    startedAt,
    ...(status === "done" || status === "error" ? { endedAt: startedAt + 1200 } : {}),
  };
}

function tr(callId: string, output: string, ok = true): Extract<MessageEntry, { kind: "tool_result" }> {
  return { kind: "tool_result", callId, output, ok };
}

export const MARKETING_SCENARIOS: MarketingScenario[] = [
  {
    id: "coding-typescript",
    title: "Write & verify code",
    description: "File write, shell type-check, streamed answer — the default coding loop.",
    theme: DEFAULT_PERSONA_UI_THEME,
    displayLabel: "Liminal",
    personaName: "Liminal",
    contextPct: 11,
    frames: [
      [
        {
          kind: "user",
          text: "Write a well-typed TypeScript `debounce` function, then explain in two sentences how it works.",
        },
      ],
      [
        {
          kind: "user",
          text: "Write a well-typed TypeScript `debounce` function, then explain in two sentences how it works.",
        },
        {
          kind: "think",
          content:
            "Create `src/debounce.ts` with generics, cancel/flush helpers, then run `tsc --noEmit` to verify.",
          tool_families: ["files_edit", "shell"],
        },
        tc("c1", "write_file", "running", '{"path":"src/debounce.ts","mode":"create"}', 40),
      ],
      [
        {
          kind: "user",
          text: "Write a well-typed TypeScript `debounce` function, then explain in two sentences how it works.",
        },
        tc("c1", "write_file", "done", '{"path":"src/debounce.ts"}', 40),
        tr("c1", "Wrote 1,842 bytes → src/debounce.ts"),
        tc("c2", "run_shell", "error", '{"command":"npx tsc --noEmit -p tsconfig.json"}', 200),
        tr("c2", "error TS2307: Cannot find module './debounce'"),
        tc("c3", "run_shell", "running", '{"command":"npx tsc --noEmit -p tsconfig.json"}', 800),
      ],
      [
        {
          kind: "user",
          text: "Write a well-typed TypeScript `debounce` function, then explain in two sentences how it works.",
        },
        tc("c1", "write_file", "done", '{"path":"src/debounce.ts"}', 40),
        tr("c1", "Wrote 1,842 bytes → src/debounce.ts"),
        tc("c2", "run_shell", "error", '{"command":"npx tsc --noEmit"}', 200),
        tr("c2", "error TS2307 (resolved on retry)"),
        tc("c3", "run_shell", "done", '{"command":"npx tsc --noEmit -p tsconfig.json"}', 800),
        tr("c3", "Exit 0 — strict mode clean"),
        {
          kind: "assistant",
          text: `Type-checked clean under \`--strict\` — no errors. Here's the file and the explanation.

**How it works:** Every call to the debounced function clears the previous timer and starts a fresh \`setTimeout\`, so the original \`fn\` only fires once calls stop arriving for \`delayMs\`. The \`.cancel()\` method clears any queued invocation; \`.flush()\` runs immediately with the last-captured arguments — useful for saving form state on unmount.`,
          streaming: false,
        },
      ],
    ],
  },
  {
    id: "memory-recall",
    title: "Hybrid memory recall",
    description: "BM25 + embeddings surface prior workspace notes with provenance.",
    theme: { ...DEFAULT_PERSONA_UI_THEME, accent: "#44ffaa", secondary: "#00d4ff" },
    displayLabel: "Liminal",
    contextPct: 18,
    frames: [
      [
        {
          kind: "user",
          text: "What did we decide about API auth for the internal dashboard last week?",
        },
      ],
      [
        {
          kind: "user",
          text: "What did we decide about API auth for the internal dashboard last week?",
        },
        tc("m1", "recall_relevant", "running", '{"query":"API auth internal dashboard","workspace_scope":"current"}', 30),
      ],
      [
        {
          kind: "user",
          text: "What did we decide about API auth for the internal dashboard last week?",
        },
        tc("m1", "recall_relevant", "done", '{"query":"API auth internal dashboard"}', 30),
        tr(
          "m1",
          "3 notes (workspace):\n• pref:auth-dashboard — magic-link only, 15m TTL (sibling chat)\n• decision:api-gateway — JWT for public API, not dashboard (own chat)\n• reflection:session-042 — rejected shared cookies (global)"
        ),
        {
          kind: "assistant",
          text: "Last week you locked the **internal dashboard** to **magic-link auth** (15-minute TTL, no password form). The **public API** stays on JWT — that decision was explicitly split so dashboard sessions never share cookie jars with third-party clients.",
          streaming: false,
        },
      ],
    ],
  },
  {
    id: "web-research",
    title: "Web research",
    description: "Parallel web_search + web_fetch with grouped tool cards.",
    theme: DEFAULT_PERSONA_UI_THEME,
    displayLabel: "Liminal",
    contextPct: 22,
    frames: [
      [
        {
          kind: "user",
          text: "Compare OpenRouter prompt caching vs Anthropic's — cite primary docs, 3 bullets max.",
        },
      ],
      [
        {
          kind: "user",
          text: "Compare OpenRouter prompt caching vs Anthropic's — cite primary docs, 3 bullets max.",
        },
        tc("w1", "web_search", "done", '{"query":"OpenRouter prompt caching cache_control"}', 20),
        tr("w1", "8 results"),
        tc("w2", "web_search", "done", '{"query":"Anthropic prompt caching documentation"}', 25),
        tr("w2", "6 results"),
        tc("w3", "web_fetch", "running", '{"url":"https://openrouter.ai/docs/guides/prompt-caching"}', 40),
        tc("w4", "web_fetch", "running", '{"url":"https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching"}', 45),
      ],
      [
        {
          kind: "user",
          text: "Compare OpenRouter prompt caching vs Anthropic's — cite primary docs, 3 bullets max.",
        },
        tc("w1", "web_search", "done", '{"query":"OpenRouter prompt caching"}', 20),
        tr("w1", "8 results"),
        tc("w2", "web_search", "done", '{"query":"Anthropic prompt caching"}', 25),
        tr("w2", "6 results"),
        tc("w3", "web_fetch", "done", '{"url":"https://openrouter.ai/docs/guides/prompt-caching"}', 40),
        tr("w3", "Article extracted (4.2k chars)"),
        tc("w4", "web_fetch", "done", '{"url":"https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching"}', 45),
        tr("w4", "Article extracted (3.8k chars)"),
        {
          kind: "assistant",
          text: `- **OpenRouter** — provider-agnostic \`cache_control: ephemeral\` on static prefixes; billed at each provider's cache-read rate on rounds 2+.\n- **Anthropic** — native \`cache_control\` blocks with 5m / 1h TTL tiers on Claude; write + read priced separately.\n- **Practical delta** — Liminal pins one provider when caching matters; mixing routes invalidates cache hits.`,
          streaming: false,
        },
      ],
    ],
  },
  {
    id: "git-workflow",
    title: "Git workflow",
    description: "Status → diff → commit with inline tool trace.",
    theme: { ...DEFAULT_PERSONA_UI_THEME, shell: "terminal", typography: "mono" },
    displayLabel: "Liminal",
    contextPct: 9,
    frames: [
      [
        { kind: "user", text: "Stage the harness settings changes and commit with a clear message." },
        tc("g1", "git_status", "running", "{}", 10),
      ],
      [
        { kind: "user", text: "Stage the harness settings changes and commit with a clear message." },
        tc("g1", "git_status", "done", "{}", 10),
        tr("g1", "M packages/core/src/harness_settings_field_meta.ts\n?? docs/reference/environment.md"),
        tc("g2", "git_diff", "done", '{"path":"packages/core/src/harness_settings_field_meta.ts"}', 80),
        tr("g2", "+42 −3 lines"),
        tc("g3", "git_commit", "running", '{"message":"docs: regenerate harness settings metadata"}', 200),
      ],
      [
        { kind: "user", text: "Stage the harness settings changes and commit with a clear message." },
        tc("g1", "git_status", "done", "{}", 10),
        tr("g1", "clean except staged"),
        tc("g2", "git_diff", "done", '{"path":"packages/core/src/harness_settings_field_meta.ts"}', 80),
        tr("g2", "staged diff shown"),
        tc("g3", "git_commit", "done", '{"message":"docs: regenerate harness settings metadata"}', 200),
        tr("g3", "[main a1b2c3d] docs: regenerate harness settings metadata\n 2 files changed, 58 insertions(+)"),
        {
          kind: "assistant",
          text: "Committed on `main` as `a1b2c3d` — settings metadata + regenerated env doc. Working tree is clean.",
          streaming: false,
        },
      ],
    ],
  },
  {
    id: "subagents",
    title: "Sub-agent orchestration",
    description: "spawn_agent cards with parallel child work.",
    theme: DEFAULT_PERSONA_UI_THEME,
    displayLabel: "Liminal",
    contextPct: 31,
    frames: [
      [
        {
          kind: "user",
          text: "Audit the eval package for flaky scenarios — spawn a focused reviewer per failure class.",
        },
        tc("s1", "spawn_agent", "done", '{"goal":"Review memory_retrieval flakes"}', 50),
        {
          kind: "subtask",
          taskId: "child-a",
          parentTaskId: "root",
          goal: "Review memory_retrieval flakes",
          depth: 1,
          status: "running",
          partialOutput: "grep: timeout in recall_relevant…",
        },
      ],
      [
        {
          kind: "user",
          text: "Audit the eval package for flaky scenarios — spawn a focused reviewer per failure class.",
        },
        {
          kind: "subtask",
          taskId: "child-a",
          parentTaskId: "root",
          goal: "Review memory_retrieval flakes",
          depth: 1,
          status: "done",
          partialOutput: "Root cause: embed model cold-start; suggest AGENT_EMBED_MODEL warmup in eval bootstrap.",
        },
        {
          kind: "subtask",
          taskId: "child-b",
          parentTaskId: "root",
          goal: "Review browser_local CAPTCHA skips",
          depth: 1,
          status: "running",
          partialOutput: "Checking AGENT_CAPTCHA_KEY gate…",
        },
        {
          kind: "assistant",
          text: "Two sub-agents finished review passes. **memory_retrieval** flakes trace to embedding cold-start — add a 1-line warmup in eval bootstrap. **browser_local** skips are expected when `AGENT_CAPTCHA_KEY` is unset in CI.",
          streaming: false,
        },
      ],
    ],
  },
  {
    id: "approval-gate",
    title: "Approval gate",
    description: "Destructive shell blocked until the user authorizes.",
    theme: DEFAULT_PERSONA_UI_THEME,
    displayLabel: "Liminal",
    overlay: "approval",
    orbState: "running",
    busy: true,
    contextPct: 14,
    frames: [
      [
        {
          kind: "user",
          text: "Drop the stale docker volumes and prune dangling images.",
        },
        tc(
          "a1",
          "run_shell",
          "pending_approval",
          '{"command":"docker volume prune -f && docker image prune -af"}',
          60
        ),
      ],
    ],
  },
  {
    id: "persona-bootstrap",
    title: "Persona bootstrap",
    description: "First-run voice selection — tools and safety unchanged.",
    theme: DEFAULT_PERSONA_UI_THEME,
    overlay: "persona-bootstrap",
    frames: [[]],
  },
  {
    id: "reasoning-plan",
    title: "Think → plan → execute",
    description: "External reasoning surface with visible think/plan cards.",
    theme: DEFAULT_PERSONA_UI_THEME,
    displayLabel: "Liminal",
    contextPct: 16,
    frames: [
      [
        {
          kind: "user",
          text: "Refactor the SSE reducer busy-unlock heuristic — keep behavior, add a unit test.",
        },
        {
          kind: "think",
          content:
            "Need read_file on useSSE.ts, grep for BUSY_STALL constants, then edit_file + test run.",
          scope: "packages/web/client",
        },
      ],
      [
        {
          kind: "user",
          text: "Refactor the SSE reducer busy-unlock heuristic — keep behavior, add a unit test.",
        },
        {
          kind: "think",
          content: "Need read_file on useSSE.ts, grep for BUSY_STALL constants, then edit_file + test.",
          scope: "packages/web/client",
        },
        {
          kind: "plan",
          steps: [
            "Read `useSSE.ts` busy-unlock block",
            "Extract `shouldUnlockBusyHeuristic()` helper",
            "Add vitest cases for stall + degraded transport",
            "Run package typecheck",
          ],
        },
        tc("r1", "read_file", "done", '{"path":"packages/web/client/useSSE.ts"}', 100),
        tr("r1", "2163 lines"),
      ],
      [
        {
          kind: "user",
          text: "Refactor the SSE reducer busy-unlock heuristic — keep behavior, add a unit test.",
        },
        {
          kind: "plan",
          steps: [
            "Read `useSSE.ts` busy-unlock block",
            "Extract `shouldUnlockBusyHeuristic()` helper",
            "Add vitest cases for stall + degraded transport",
            "Run package typecheck",
          ],
        },
        tc("r1", "read_file", "done", '{"path":"packages/web/client/useSSE.ts"}', 100),
        tr("r1", "2163 lines"),
        tc("r2", "edit_file", "done", '{"path":"packages/web/client/busyUnlock.ts"}', 400),
        tr("r2", "Applied 1 replacement"),
        tc("r3", "run_tests", "done", '{"scope":"packages/web"}', 900),
        tr("r3", "3 passed"),
        {
          kind: "assistant",
          text: "Extracted `shouldUnlockBusyHeuristic()` with unchanged thresholds; added 3 vitest cases covering stall, degraded SSE, and server-busy reconciliation.",
          streaming: false,
        },
      ],
    ],
  },
  // ── Advanced / “hard” scenarios (multi-tool, cross-surface) ─────────────────
  {
    id: "semantic-rename",
    title: "Semantic rename across the repo",
    description: "TS language-service rename + lint + tests on a real symbol sweep.",
    theme: { ...DEFAULT_PERSONA_UI_THEME, typography: "mono", toolCards: "verbose" },
    displayLabel: "Liminal",
    contextPct: 24,
    frames: [
      [
        {
          kind: "user",
          text: "Rename `getFastModelSlug` → `resolveFastModelSlug` everywhere under `packages/core` and `packages/tools`. Update imports, then typecheck + core tests.",
        },
        {
          kind: "think",
          content:
            "Use symbol_index + find_references to scope blast radius, rename_symbol for project-wide edit, then run_lint + run_tests on core.",
          tool_families: ["code_intel", "files_edit", "shell"],
        },
        {
          kind: "plan",
          steps: [
            "Index symbols in packages/core",
            "find_references for getFastModelSlug",
            "rename_symbol (router.ts + importers)",
            "run_lint changed-first, then npm test -w @liminal/core",
          ],
        },
      ],
      [
        {
          kind: "user",
          text: "Rename `getFastModelSlug` → `resolveFastModelSlug` everywhere under `packages/core` and `packages/tools`. Update imports, then typecheck + core tests.",
        },
        tc("sr1", "symbol_index", "done", '{"paths":["packages/core/src"]}', 50),
        tr("sr1", "Indexed 71 files · 1,842 symbols"),
        tc("sr2", "find_references", "done", '{"symbol":"getFastModelSlug","path":"packages/core/src/router.ts"}', 120),
        tr("sr2", "14 references across 9 files"),
        tc("sr3", "rename_symbol", "running", '{"symbol":"getFastModelSlug","newName":"resolveFastModelSlug"}', 200),
      ],
      [
        {
          kind: "user",
          text: "Rename `getFastModelSlug` → `resolveFastModelSlug` everywhere under `packages/core` and `packages/tools`. Update imports, then typecheck + core tests.",
        },
        tc("sr3", "rename_symbol", "done", '{"symbol":"getFastModelSlug","newName":"resolveFastModelSlug"}', 200),
        tr("sr3", "Applied 23 edits in 9 files (rollback manifest saved)"),
        tc("sr4", "run_lint", "done", '{"mode":"tsc","scope":"changed"}', 400),
        tr("sr4", "0 errors"),
        tc("sr5", "run_tests", "running", '{"workspace":"@liminal/core"}', 500),
      ],
      [
        {
          kind: "user",
          text: "Rename `getFastModelSlug` → `resolveFastModelSlug` everywhere under `packages/core` and `packages/tools`. Update imports, then typecheck + core tests.",
        },
        tc("sr1", "symbol_index", "done", '{"paths":["packages/core/src"]}', 50),
        tr("sr1", "Indexed 71 files"),
        tc("sr2", "find_references", "done", '{"symbol":"getFastModelSlug"}', 120),
        tr("sr2", "14 references · 9 files"),
        tc("sr3", "rename_symbol", "done", '{"newName":"resolveFastModelSlug"}', 200),
        tr("sr3", "23 edits · rollback manifest saved"),
        tc("sr4", "run_lint", "done", '{"mode":"tsc"}', 400),
        tr("sr4", "0 errors"),
        tc("sr5", "run_tests", "done", '{"workspace":"@liminal/core"}', 500),
        tr("sr5", "118 passed · 42.3s"),
        {
          kind: "assistant",
          text: "Renamed across **9 files** (23 call sites). `tsc` clean on changed scope; **118/118** core tests green. Rollback manifest at `.agent_artifacts/rename-8f2a.json` if you need to revert.",
          streaming: false,
        },
      ],
    ],
  },
  {
    id: "fix-flaky-tests",
    title: "Diagnose & fix flaky CI",
    description: "Read failure artifacts, patch ranking logic, re-run until green.",
    theme: DEFAULT_PERSONA_UI_THEME,
    displayLabel: "Liminal",
    contextPct: 19,
    frames: [
      [
        {
          kind: "user",
          text: "`memory_rank.test.ts` fails intermittently on CI (BM25 tie-break). Fix the root cause — do not loosen assertions.",
        },
        tc("f1", "failure_review", "done", '{"limit":5,"tool":"memory_query"}', 20),
        tr("f1", "Latest: expected note `pref:auth` ranked #1, got `reflection:session-12`"),
        tc("f2", "read_file", "running", '{"path":"packages/core/src/memory_rank.ts"}', 80),
      ],
      [
        {
          kind: "user",
          text: "`memory_rank.test.ts` fails intermittently on CI (BM25 tie-break). Fix the root cause — do not loosen assertions.",
        },
        tc("f2", "read_file", "done", '{"path":"packages/core/src/memory_rank.ts"}', 80),
        tr("f2", "412 lines"),
        tc("f3", "grep_file", "done", '{"pattern":"siblingDiscount|workspaceFingerprint","path":"packages/core"}', 150),
        tr("f3", "6 matches in memory_rank.ts + memory_rank.test.ts"),
        {
          kind: "think",
          content:
            "Tie-break ignores `scope:global` boost when sibling discount applies — patch sort key, add deterministic fixture.",
        },
      ],
      [
        {
          kind: "user",
          text: "`memory_rank.test.ts` fails intermittently on CI (BM25 tie-break). Fix the root cause — do not loosen assertions.",
        },
        tc("f4", "edit_file", "done", '{"path":"packages/core/src/memory_rank.ts","replacements":1}', 300),
        tr("f4", "Applied 1 replacement (sort key: scope tier before recency)"),
        tc("f5", "run_tests", "error", '{"filter":"memory_rank"}', 450),
        tr("f5", "1 failed: tie-break edge case still flaky on 2/3 runs"),
        tc("f6", "edit_file", "done", '{"path":"packages/core/src/memory_rank.test.ts"}', 600),
        tr("f6", "Stabilized fixture timestamps + sibling chat id"),
      ],
      [
        {
          kind: "user",
          text: "`memory_rank.test.ts` fails intermittently on CI (BM25 tie-break). Fix the root cause — do not loosen assertions.",
        },
        tc("f1", "failure_review", "done", '{"limit":5}', 20),
        tr("f1", "Latest: pref:auth expected #1"),
        tc("f2", "read_file", "done", '{"path":"packages/core/src/memory_rank.ts"}', 80),
        tr("f2", "412 lines"),
        tc("f4", "edit_file", "done", '{"path":"packages/core/src/memory_rank.ts"}', 300),
        tr("f4", "sort key: scope tier before recency"),
        tc("f5", "run_tests", "error", '{"filter":"memory_rank"}', 450),
        tr("f5", "1 failed on 2/3 runs"),
        tc("f6", "edit_file", "done", '{"path":"packages/core/src/memory_rank.test.ts"}', 600),
        tr("f6", "Stabilized fixture timestamps"),
        tc("f7", "run_tests", "done", '{"filter":"memory_rank","repeat":3}', 800),
        tr("f7", "9 passed × 3 repetitions · 0 flakes"),
        {
          kind: "assistant",
          text: "Root cause was **sort key ordering** when sibling discount tied with global-scope notes — fixed ranking, hardened test fixtures. `memory_rank` suite **9/9 × 3** repeats with no flakes.",
          streaming: false,
        },
      ],
    ],
  },
  {
    id: "browser-staging",
    title: "Headless browser workflow",
    description: "Open admin, snapshot DOM, extract structured state.",
    theme: { ...DEFAULT_PERSONA_UI_THEME, accent: "#6ecbff", panelLayout: "right" },
    displayLabel: "Liminal",
    contextPct: 27,
    frames: [
      [
        {
          kind: "user",
          text: "Check whether https://staging.vireondynamics.com/admin/login still shows the magic-link gate — screenshot the form and list required fields.",
        },
        tc("b1", "activate_tool_family", "done", '{"family":"browser"}', 10),
        tr("b1", "Registered browser_* tools"),
        tc("b2", "browser_open", "done", '{"headless":true,"stealth":true}', 40),
        tr("b2", "session_id=br_7f2a"),
      ],
      [
        {
          kind: "user",
          text: "Check whether https://staging.vireondynamics.com/admin/login still shows the magic-link gate — screenshot the form and list required fields.",
        },
        tc("b3", "browser_navigate", "done", '{"url":"https://staging.vireondynamics.com/admin/login"}', 120),
        tr("b3", "200 · DOM ready 1.8s"),
        tc("b4", "browser_snapshot", "done", '{"session_id":"br_7f2a","max_chars":12000}', 400),
        tr("b4", "Accessibility tree · 142 nodes"),
        tc("b5", "browser_extract", "running", '{"selectors":["form","input","button"]}', 500),
      ],
      [
        {
          kind: "user",
          text: "Check whether https://staging.vireondynamics.com/admin/login still shows the magic-link gate — screenshot the form and list required fields.",
        },
        tc("b1", "activate_tool_family", "done", '{"family":"browser"}', 10),
        tr("b1", "browser_* registered"),
        tc("b2", "browser_open", "done", '{"stealth":true}', 40),
        tr("b2", "session br_7f2a"),
        tc("b3", "browser_navigate", "done", '{"url":"https://staging.vireondynamics.com/admin/login"}', 120),
        tr("b3", "200 · 1.8s"),
        tc("b4", "browser_snapshot", "done", '{"max_chars":12000}', 400),
        tr("b4", "142 nodes"),
        tc("b5", "browser_extract", "done", '{"selectors":["form","input","button"]}', 500),
        tr("b5", "email + magic-link CTA · no captcha"),
        tc("b6", "browser_act", "done", '{"action":"screenshot"}', 700),
        tr("b6", "staging-login.png"),
        {
          kind: "assistant",
          text: "Staging login is **magic-link only**: single `email` field + **Send magic link** CTA — no password, CAPTCHA, or OTP on this build. Full-page capture saved to artifacts.",
          streaming: false,
        },
      ],
    ],
  },
  {
    id: "document-deck",
    title: "Document engine (PPTX)",
    description: "IR compose → lint → render with quality gate.",
    theme: { ...DEFAULT_PERSONA_UI_THEME, shell: "studio", density: "comfortable" },
    displayLabel: "Liminal",
    contextPct: 34,
    frames: [
      [
        {
          kind: "user",
          text: "Create a 6-slide investor deck for Liminal harness: problem, architecture, moat, traction, roadmap, ask. Quality ≥90, export PPTX.",
        },
        tc("d1", "doc_plan", "done", '{"title":"Liminal — agent harness","slides":6}', 30),
        tr("d1", "doc_id=doc_9a2f · manifest written"),
        tc("d2", "doc_research_brief", "done", '{"doc_id":"doc_9a2f"}', 80),
        tr("d2", "Brief: 4 bullets from repo + blog"),
      ],
      [
        {
          kind: "user",
          text: "Create a 6-slide investor deck for Liminal harness: problem, architecture, moat, traction, roadmap, ask. Quality ≥90, export PPTX.",
        },
        tc("d3", "doc_compose_chunk", "done", '{"doc_id":"doc_9a2f","section":"architecture"}', 200),
        tr("d3", "Slide 2–3 composed (ReAct loop diagram)"),
        tc("d4", "doc_compose_chunk", "done", '{"doc_id":"doc_9a2f","section":"traction"}', 350),
        tr("d4", "Slide 4–5 composed (eval pass rates)"),
        tc("d5", "doc_lint_layout", "running", '{"doc_id":"doc_9a2f"}', 500),
      ],
      [
        {
          kind: "user",
          text: "Create a 6-slide investor deck for Liminal harness: problem, architecture, moat, traction, roadmap, ask. Quality ≥90, export PPTX.",
        },
        tc("d1", "doc_plan", "done", '{"slides":6}', 30),
        tr("d1", "doc_9a2f"),
        tc("d2", "doc_research_brief", "done", '{}', 80),
        tr("d2", "4 bullets from repo"),
        tc("d3", "doc_compose_chunk", "done", '{"section":"architecture"}', 200),
        tr("d3", "Slides 2–3"),
        tc("d4", "doc_compose_chunk", "done", '{"section":"traction"}', 350),
        tr("d4", "Slides 4–5"),
        tc("d5", "doc_lint_layout", "done", '{}', 500),
        tr("d5", "0 blocking"),
        tc("d6", "doc_render_pptx", "done", '{}', 700),
        tr("d6", "liminal-investor-deck.pptx"),
        tc("d7", "doc_quality_report", "done", '{}', 850),
        tr("d7", "score=92 PASS"),
        {
          kind: "assistant",
          text: "Deck exported as **`liminal-investor-deck.pptx`** — quality **92/100** (gate ≥90). Architecture slides include harness loop + tool-dispatcher diagram; traction slide pulls eval pass rates from `packages/eval`.",
          streaming: false,
        },
      ],
    ],
  },
  {
    id: "parallel-review",
    title: "Parallel commit review",
    description: "Three sub-agents, one per commit, merged synthesis.",
    theme: DEFAULT_PERSONA_UI_THEME,
    displayLabel: "Liminal",
    contextPct: 38,
    busy: true,
    orbState: "running",
    frames: [
      [
        {
          kind: "user",
          text: "Review the last 3 commits on this branch for harness regressions — spawn one reviewer per commit, then summarize blockers.",
        },
        {
          kind: "plan",
          steps: [
            "git_log -3 for SHAs",
            "spawn_agent per commit (diff scope)",
            "wait_for_agents → merge findings",
          ],
        },
        tc("p1", "git_log", "done", '{"max":3}', 20),
        tr("p1", "a1b2c3d · 9e8f7a6 · 4d5c6b7"),
        tc("p2", "spawn_agent", "done", '{"goal":"Review a1b2c3d harness touch"}', 80),
        tc("p3", "spawn_agent", "done", '{"goal":"Review 9e8f7a6 context compression"}', 85),
        tc("p4", "spawn_agent", "done", '{"goal":"Review 4d5c6b7 tool lazy-load"}', 90),
      ],
      [
        {
          kind: "user",
          text: "Review the last 3 commits on this branch for harness regressions — spawn one reviewer per commit, then summarize blockers.",
        },
        {
          kind: "subtask",
          taskId: "rev-a",
          parentTaskId: "root",
          goal: "Review a1b2c3d — prompt cache telemetry",
          depth: 1,
          status: "done",
          partialOutput: "OK: cache hit % logged; no default secret leakage.",
        },
        {
          kind: "subtask",
          taskId: "rev-b",
          parentTaskId: "root",
          goal: "Review 9e8f7a6 — context compression",
          depth: 1,
          status: "done",
          partialOutput: "WARN: warm-tier truncation may drop tool provenance on 9+ round turns — suggest AGENT_CTX_WARM_ROUNDS bump.",
        },
        {
          kind: "subtask",
          taskId: "rev-c",
          parentTaskId: "root",
          goal: "Review 4d5c6b7 — lazy tool load",
          depth: 1,
          status: "running",
          partialOutput: "Checking activate_tool_family idempotency…",
        },
      ],
      [
        {
          kind: "user",
          text: "Review the last 3 commits on this branch for harness regressions — spawn one reviewer per commit, then summarize blockers.",
        },
        tc("p1", "git_log", "done", '{"max":3}', 20),
        tr("p1", "3 SHAs"),
        tc("p2", "spawn_agent", "done", '{"goal":"Review a1b2c3d"}', 80),
        tr("p2", "child rev-a"),
        tc("p3", "spawn_agent", "done", '{"goal":"Review 9e8f7a6"}', 85),
        tr("p3", "child rev-b"),
        tc("p4", "spawn_agent", "done", '{"goal":"Review 4d5c6b7"}', 90),
        tr("p4", "child rev-c"),
        {
          kind: "subtask",
          taskId: "rev-a",
          parentTaskId: "root",
          goal: "Review a1b2c3d — prompt cache",
          depth: 1,
          status: "done",
          partialOutput: "OK: cache telemetry safe",
        },
        {
          kind: "subtask",
          taskId: "rev-b",
          parentTaskId: "root",
          goal: "Review 9e8f7a6 — compression",
          depth: 1,
          status: "done",
          partialOutput: "WARN: warm-tier provenance on 9+ rounds",
        },
        {
          kind: "subtask",
          taskId: "rev-c",
          parentTaskId: "root",
          goal: "Review 4d5c6b7 — lazy load",
          depth: 1,
          status: "done",
          partialOutput: "OK: idempotent activate",
        },
        tc("p5", "wait_for_agents", "done", '{"timeout_ms":120000}', 1200),
        tr("p5", "3/3 completed"),
        {
          kind: "assistant",
          text: "**Blockers:** none. **Warnings:** 1 — long-turn sessions (9+ rounds) may lose tool provenance in warm tier; consider `AGENT_CTX_WARM_ROUNDS=10` before release. Cache telemetry + lazy-load paths look safe.",
          streaming: false,
        },
      ],
    ],
  },
  {
    id: "atomic-migration",
    title: "Atomic multi-file migration",
    description: "Rollback-aware patch across API routes + client fetchers.",
    theme: { ...DEFAULT_PERSONA_UI_THEME, shell: "hud", toolCards: "verbose" },
    displayLabel: "Liminal",
    contextPct: 29,
    frames: [
      [
        {
          kind: "user",
          text: "Migrate public settings endpoints from `/api/v1/settings` → `/api/v2/settings` across server routes and web client — atomic apply with rollback if tests fail.",
        },
        {
          kind: "think",
          content:
            "grep all v1 settings paths, build multi_file_apply batch, run_tests web+server, git_diff summary.",
          tool_families: ["code_intel", "files_edit", "shell", "git"],
        },
        tc("m1", "grep_file", "done", '{"pattern":"/api/v1/settings","path":"."}', 40),
        tr("m1", "11 files · 28 matches"),
      ],
      [
        {
          kind: "user",
          text: "Migrate public settings endpoints from `/api/v1/settings` → `/api/v2/settings` across server routes and web client — atomic apply with rollback if tests fail.",
        },
        tc("m2", "multi_file_apply", "running", '{"operations":7,"rollback":true}', 200),
        tr("m2", "Staging 7 files…"),
      ],
      [
        {
          kind: "user",
          text: "Migrate public settings endpoints from `/api/v1/settings` → `/api/v2/settings` across server routes and web client — atomic apply with rollback if tests fail.",
        },
        tc("m2", "multi_file_apply", "done", '{"operations":7,"rollback":true}', 200),
        tr("m2", "Committed batch · manifest multi-apply-3c91.json"),
        tc("m3", "run_tests", "error", '{"workspace":"@liminal/web"}', 500),
        tr("m3", "1 failed: routes.test.ts expected 404 on deprecated v1"),
        tc("m4", "edit_file", "done", '{"path":"packages/web/server/routes.test.ts"}', 650),
        tr("m4", "Added v1 deprecation shim test"),
      ],
      [
        {
          kind: "user",
          text: "Migrate public settings endpoints from `/api/v1/settings` → `/api/v2/settings` across server routes and web client — atomic apply with rollback if tests fail.",
        },
        tc("m1", "grep_file", "done", '{"pattern":"/api/v1/settings"}', 40),
        tr("m1", "11 files"),
        tc("m2", "multi_file_apply", "done", '{"operations":7}', 200),
        tr("m2", "batch committed"),
        tc("m3", "run_tests", "error", '{"workspace":"@liminal/web"}', 500),
        tr("m3", "1 failed: v1 shim"),
        tc("m4", "edit_file", "done", '{"path":"routes.test.ts"}', 650),
        tr("m4", "deprecation test added"),
        tc("m5", "run_tests", "done", '{"workspace":"@liminal/web"}', 900),
        tr("m5", "14 passed"),
        tc("m6", "git_diff", "done", '{"stat":true}', 1000),
        tr("m6", "+31 −28 across 7 files"),
        {
          kind: "assistant",
          text: "Migrated **7 files** atomically; added v1 **deprecation shim** so existing clients get 308 → v2. Web tests **14/14** green. Rollback manifest saved if you need to revert before merge.",
          streaming: false,
        },
      ],
    ],
  },
  {
    id: "research-synthesis",
    title: "Deep research synthesis",
    description: "Multi-fetch research grade pass with structured output.",
    theme: DEFAULT_PERSONA_UI_THEME,
    displayLabel: "Liminal",
    contextPct: 41,
    frames: [
      [
        {
          kind: "user",
          text: "Research ReAct agent benchmarks (2024–2026): SWE-bench, WebArena, and tool-use evals. Cross-check claims against primary papers, output a comparison table + gaps Liminal could own.",
        },
        tc("rs1", "web_search", "done", '{"query":"SWE-bench verified 2025 agent results"}', 10),
        tr("rs1", "10 results"),
        tc("rs2", "web_search", "done", '{"query":"WebArena leaderboard LLM agents"}', 15),
        tr("rs2", "8 results"),
        tc("rs3", "web_search", "done", '{"query":"tool use benchmark API-Bank AgentBench"}', 20),
        tr("rs3", "9 results"),
      ],
      [
        {
          kind: "user",
          text: "Research ReAct agent benchmarks (2024–2026): SWE-bench, WebArena, and tool-use evals. Cross-check claims against primary papers, output a comparison table + gaps Liminal could own.",
        },
        tc("rs4", "web_fetch", "done", '{"url":"https://arxiv.org/abs/2407.01476"}', 100),
        tr("rs4", "PDF abstract + methods extracted"),
        tc("rs5", "web_fetch", "done", '{"url":"https://webarena.dev/leaderboard"}', 110),
        tr("rs5", "Leaderboard HTML parsed · 24 rows"),
        tc("rs6", "web_fetch", "done", '{"url":"https://github.com/THUDM/AgentBench"}', 120),
        tr("rs6", "README + eval harness section"),
        tc("rs7", "extract_structured", "running", '{"schema":"benchmark_table"}', 400),
      ],
      [
        {
          kind: "user",
          text: "Research ReAct agent benchmarks (2024–2026): SWE-bench, WebArena, and tool-use evals. Cross-check claims against primary papers, output a comparison table + gaps Liminal could own.",
        },
        tc("rs1", "web_search", "done", '{"query":"SWE-bench verified 2025"}', 10),
        tr("rs1", "10 results"),
        tc("rs2", "web_search", "done", '{"query":"WebArena leaderboard"}', 15),
        tr("rs2", "8 results"),
        tc("rs3", "web_search", "done", '{"query":"AgentBench tool use"}', 20),
        tr("rs3", "9 results"),
        tc("rs4", "web_fetch", "done", '{"url":"https://arxiv.org/abs/2407.01476"}', 100),
        tr("rs4", "paper extracted"),
        tc("rs5", "web_fetch", "done", '{"url":"https://webarena.dev/leaderboard"}', 110),
        tr("rs5", "24 rows"),
        tc("rs6", "web_fetch", "done", '{"url":"https://github.com/THUDM/AgentBench"}', 120),
        tr("rs6", "README parsed"),
        tc("rs7", "extract_structured", "done", '{"schema":"benchmark_table"}', 400),
        tr("rs7", "6 rows verified"),
        {
          kind: "assistant",
          text: `| Benchmark | What it measures | Liminal angle |\n|-----------|------------------|---------------|\n| **SWE-bench Verified** | Real repo patches | Harness already optimizes long edits + lint heal |\n| **WebArena** | Live site tasks | browser_* + captcha + fetch retries |\n| **AgentBench** | Tool-planning | Lazy families + approval gates |\n\n**Gap to own:** cross-session memory + workspace-scoped recall — most leaderboards are single-episode.`,
          streaming: false,
        },
      ],
    ],
  },
];

export function getMarketingScenario(id: string): MarketingScenario | undefined {
  return MARKETING_SCENARIOS.find((s) => s.id === id);
}

export const MARKETING_SCENARIO_IDS = MARKETING_SCENARIOS.map((s) => s.id);
