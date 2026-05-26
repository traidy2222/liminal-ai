# Harness protocol and named rules

This document describes how Liminal nudges the model toward reliable, coherent multi-step work. It complements `packages/tools/src/systemPrompt.ts` (always-on protocol) and `packages/core/src/harness_rules.ts` (round-2 harness injection).

## Two layers of guidance

| Layer | Where | When |
|--------|--------|------|
| **Protocol core** | `PROTOCOL_CORE` + `PROTOCOL_NAMED_RULES` in `systemPrompt.ts` | Every turn, in the system prompt |
| **Harness rule recall** | `HARNESS_RULES` keys + `buildHarnessRuleRecallMessage()` in `harness_rules.ts` | Injected as a **system** message once per `send()`, at **ReAct round 2**, unless disabled |

The harness layer lists **compact R-* IDs only** (sorted by `.agent_rule_stats.json` violation counts when stats exist). Full prose for each ID lives in `PROTOCOL_NAMED_RULES` (`systemPrompt.ts`) so round-2 recall does not duplicate long paragraphs.

### Disabling or tuning recall

- Set **`AGENT_RULE_RECALL=0`** to skip the round-2 harness rule block entirely.
- Rule effectiveness is tracked in **`.agent_rule_stats.json`** (see [Architecture](./architecture.md#rule-effectiveness-tracking)). After structured reflexion on failure rounds, `bumpRuleHits()` increments counters for any `R-*` IDs found in the failure context.

### Adaptive selection (implementation note)

`buildHarnessRuleRecallMessage(hitCounts)` lists every rule ID in `HARNESS_RULES`. When `.agent_rule_stats.json` has entries, IDs are sorted with highest violation counts first; canonical definitions remain under `## Named rules` in the fixed system protocol. `buildAdaptiveRuleMessage` is a deprecated alias (the `topN` parameter is ignored).

## Harness-injected rules (`HARNESS_RULES`)

These are the rules emitted in the round-2 recall block (authoritative text lives in `packages/core/src/harness_rules.ts`).

| ID | Purpose (summary) |
|----|---------------------|
| **R-PLAN-3STEPS** | User gave ≥3 ordered steps → call `plan()` before executing them with tools. |
| **R-SEQ-SETUP** | Numbered prerequisites → run in order, do not skip. |
| **R-CITE-PATHS** | After repo path tools, final reply must cite a real path from tool output. |
| **R-ORCH-ID** | After `spawn_agent`, pass returned `task_id` into `wait_for_agents`. |
| **R-SPAWN-PROMPT** | Sub-agents need real `system_prompt` + `user_prompt`, not goal-only spawns. |
| **R-CONTRACT-BOUNDS** | Respect plan execution contracts (steps/time/tool budget). |
| **R-COMMITMENT-CHECK** | Destructive/risky actions must not violate stated commitments. |
| **R-SEARCH-DIVERSITY** | First research pass: diversify search intents, not one repeated query. |
| **R-CHUNK-LARGE-FILES** | Huge files: multiple logical writes (append) to avoid stream cutoffs. |
| **R-LARGE-READ-DISCIPLINE** | No repeated full reads of the same large file; use chunked reads. |
| **R-WRITE-ONE-VERIFY** | After verified `write_file`, at most one short sanity read—then answer. |
| **R-DEDUP-TOOLS** | No duplicate same-intent `memory_query` / `recall_relevant` / same-path `read_file` / same URL `web_fetch` in one send. |
| **R-CLOSED-ARTIFACT** | HTML/XML/SVG: first write must be valid minimal document or skeleton + diff. |
| **R-READ-TOOL-ERRORS** | On tool error, apply the stated fix next (`mode: overwrite`, `edit_file` replacements/diff, etc.). |
| **R-SYNTAX-COLUMN** | `SyntaxError (path:line:column)`: anchor on that column; verify `:` vs `=`; no identical search/replace no-ops. |
| **R-RESEARCH-BUDGET** | Stop after 3–4 substantive web sources on the same angle; synthesize. |
| **R-SYNTHESIZE-VARY** | Briefings: each major theme once; avoid consecutive duplicate framing. |
| **R-MEMORY-SCOPE** | Memory is background; new research queries come from the current ask. |
| **R-MEMORY-FIRST-IDENTITY** | Identity questions → memory tools before OS username from world context. |
| **R-ONE-SHOT-RETRY** | Same failing intent with near-identical args: stop after twice, replan. |
| **R-ACTIVE-FIRST** | Prefer narrowest active tool; one new family activation when needed. |
| **R-LIVE-DATA-HONESTY** | Live claims need source + as-of; disclose uncertainty. |
| **R-SOURCE-TIER** | Calibrate language to source tier (T1–T4). |
| **R-CONTRADICT-SURFACE** | Conflicting sources → name both sides explicitly. |
| **R-ADVERSARIAL-CHECK** | After ≥3 sources on factual work, `think()` adversarially on weak claims. |
| **R-TYPECHECK-VERIFY** | Typed code edits → run project typecheck/build before claiming done. |
| **R-SCOPE-CREEP** | Fix only what was asked; no drive-by refactors. |
| **R-GREP-BEFORE-REFACTOR** | Rename/signature change → grep call sites first. |
| **R-OUTPUT-TYPOGRAPHY** | Final user text: no decorative hyphen runs; intentional markdown. |
| **R-MULTI-PART-USER** | Several questions in one message → answer or defer each part explicitly. |

## Additional named rules (protocol only)

The following appear in `PROTOCOL_NAMED_RULES` in `systemPrompt.ts` but have **no** `HARNESS_RULES` row (they still shape behavior every turn):

- **R-VERIFY-HEAVY** — Many tools or path-heavy answers → `verify_result` when available.
- **R-DECK-PIPELINE** — Slides/decks → document engine / PPTX path.
- **R-EXECUTIVE-READ** — Long sends: compact executive lead in the user reply; cut restated sections when not exhaustive/deep dive.
- **R-TURN-FRESHNESS** — New analytical asks: **What's new for this ask**; prior briefs/memory are background, not the outline.
- **R-TERM-SCOPE** — Contested terms: **Working definition** + optional **Alternate framing**.
- **R-NUMERIC-CITE** — Numbers as **reported** / **derived** / **judgment** (drivers, ranges, scenario weights).
- **R-KNOWN-UNKNOWNS** — After failures, state what was tried and what remains unknown.
- **R-RELATED-MEMORY-HOOK** — Thematic tasks: one targeted memory pass from the current ask.
- **R-SELF-CHECK-SCORE** (optional) — Meta score in `think()` only.
- **R-HARNESS-VS-MODEL** — Persona vs Liminal harness vs base LLM; do not merge OWL/ZOO branding with persona name in identity answers.

Refer to `systemPrompt.ts` for exact wording. See [Identity stack](./identity-stack.md).

## Coherent multi-step development (operational summary)

1. **Plan before sprawling** — For large creative or multi-file builds, `plan()` locks milestones and “done” criteria even when the user did not number steps.
2. **Closed artifacts** — Especially single-file HTML/JS demos: either one complete `write_file` or a minimal skeleton plus `edit_file` (replacements or diff hunks). Half-open tags cause rescue spirals.
3. **Read tool errors literally** — `write_file` with `mode: create` refuses existing paths; use `mode: overwrite` or `edit_file` for changes; repeating the wrong mode wastes rounds.
4. **Dedup retrieval** — One `memory_query` (or equivalent) with the right scope beats three identical calls.
5. **Compress once, resume smart** — After `compress_context()`, re-read only what you need to continue; do not re-fetch the same memory corpus.

## Web fetch, Readability, and JSDOM

When **`AGENT_WEB_READABILITY=1`**, `web_fetch` uses JSDOM + Mozilla Readability for article-style extraction.

- **Worker thread** — Parse runs in `web_fetch_readability_worker.ts` so pathological HTML cannot block the main event loop (which would stall `AGENT_WEB_FETCH_TOTAL_WALL_MS` timers and freeze the web UI).
- **Not a layout engine** — JSDOM does not render modern CSS like a browser. For visual truth, use Playwright `browser_*` tools.
- **Author CSS stripped before parse** — Inline `<style>`, `<link rel=stylesheet>`, and `<script>` are removed before `new JSDOM(...)`.
- **Hard wall** — Entire `web_fetch` call is capped by `AGENT_WEB_FETCH_TOTAL_WALL_MS` (default 55s).

See [Configuration](../configuration.md#web-fetch-and-readability).

## Web research (no `web_research` tool)

Multi-source research uses **`web_search`** plus selective **`web_fetch`** calls (often parallel in one round). There is no separate `web_research` tool.

1. Run 2–4 `web_search` queries with different angles (background, latest status, impact).
2. Pick 3–4 high-signal URLs per angle; respect **R-RESEARCH-BUDGET** (synthesize after enough sources).
3. `web_fetch` each URL — hard wall `AGENT_WEB_FETCH_TOTAL_WALL_MS` (default 55s per call).
4. Synthesize with timeline, source tiers, uncertainty, and open questions.

For bot walls use browser tools (`AGENT_BROWSER=1`, `npm run browser:install` once) or `AGENT_WEB_FETCH_403_RETRY` retries.

## Personality heartbeat (safety and spam avoidance)

The optional idle heartbeat (`AGENT_HEARTBEAT=1`) is **not** a second agent or parallel chat transcript. It runs **only** on the root harness when no `send()` is active, uses a **bounded** fast-model JSON contract, and by default executes **`remember` only** for typed consolidation. **Shell, web, and file-mutation tools are never auto-invoked** from the heartbeat path: there is no bypass of the normal approval gates for destructive work. Overt user nudges require **`AGENT_HEARTBEAT_SURFACE`** plus confidence and **per-hour** limits; otherwise suggestions remain trace-only or JSONL telemetry. See [Configuration — Personality heartbeat](../configuration.md#personality-heartbeat-idle-ambient-cognition) for all `AGENT_HEARTBEAT_*` keys.

## Length resume and large file writes

When a completion hits the provider **length** limit, or a file-write tool argument is **truncated** (invalid JSON or `likely_truncated` heuristics), the harness can auto-inject a `[CONTINUE]` user message instead of dispatching a partial `write_file`.

| Variable | Default | Role |
|----------|---------|------|
| `AGENT_LENGTH_RESUME_MAX` | `3` | Max continue rounds per `send()` (0 disables) |
| `AGENT_MAX_COMPLETION_TOKENS` | `0` | Main stream `max_tokens` (`0` = provider default) |
| `AGENT_WRITE_INTEGRITY_NUDGE` | `1` | System note after writes reporting `likely_truncated=true` |

### Large file writes

Use **`write_file`** with `mode: create` for the first chunk, then **`write_file`** with `mode: append` for follow-ups (or `edit_file` for targeted edits). Do not call `create` twice on the same path.

| Variable | Default | Role |
|----------|---------|------|
| `AGENT_LENGTH_RESUME_MAX` | `3` | Auto-continue truncated tool JSON / completions |
| `AGENT_WRITE_STREAM_SINK` | `1` | Stream large `content` to disk while args arrive |
| `AGENT_WRITE_INTEGRITY_NUDGE` | `1` | Nudge when `likely_truncated=true` |

Details: [Troubleshooting — incomplete writes](../operations/troubleshooting.md#file-ends-abruptly-incomplete-write).

## Related documentation

- [Configuration](../configuration.md) — narrative `AGENT_*` groups.
- [Environment reference](../reference/environment.md) — generated key table.
- [Runtime behavior](./runtime-behavior.md) — world context, reflexion, finalization.
- [Architecture](./architecture.md) — ReAct loop, dispatcher, rule stats.
