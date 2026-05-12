# Harness protocol and named rules

This document describes how Liminal nudges the model toward reliable, coherent multi-step work. It complements `packages/tools/src/systemPrompt.ts` (always-on protocol) and `packages/core/src/harness_rules.ts` (round-2 harness injection).

## Two layers of guidance

| Layer | Where | When |
|--------|--------|------|
| **Protocol core** | `PROTOCOL_CORE` + `PROTOCOL_NAMED_RULES` in `systemPrompt.ts` | Every turn, in the system prompt |
| **Harness rule recall** | `HARNESS_RULES` / `HARNESS_RULE_RECALL_MESSAGE` in `harness_rules.ts` | Injected as a **system** message once per `send()`, at **ReAct round 2**, unless disabled |

The harness layer repeats compact R-* IDs so chronic mistakes get extra weight alongside the full prose protocol.

### Disabling or tuning recall

- Set **`AGENT_RULE_RECALL=0`** to skip the round-2 harness rule block entirely.
- Rule effectiveness is tracked in **`.agent_rule_stats.json`** (see [Architecture](./architecture.md#rule-effectiveness-tracking)). After structured reflexion on failure rounds, `bumpRuleHits()` increments counters for any `R-*` IDs found in the failure context.

### Adaptive selection (implementation note)

`buildAdaptiveRuleMessage(topN, hitCounts)` can prioritize high–hit-count rules. The live harness currently loads hit counts when the stats file exists; operators tuning `topN` in `agent.ts` can shrink the injected block for token savings. When stats are empty or `topN <= 0`, the full rule set is injected.

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
| **R-READ-TOOL-ERRORS** | On tool error, apply the stated fix next (`overwrite:true`, `apply_diff`, etc.). |
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

## Additional named rules (protocol only)

The following appear in `PROTOCOL_NAMED_RULES` in `systemPrompt.ts` but are **not** duplicated in `HARNESS_RULES` (they still shape behavior every turn):

- **R-VERIFY-HEAVY** — Many tools or path-heavy answers → `verify_result` when available.
- **R-DECK-PIPELINE** — Slides/decks → document engine / PPTX path.
- **R-EXECUTIVE-READ** — Long sends: compact executive lead in the user reply.
- **R-KNOWN-UNKNOWNS** — After failures, state what was tried and what remains unknown.
- **R-RELATED-MEMORY-HOOK** — Thematic tasks: one targeted memory pass from the current ask.
- **R-SELF-CHECK-SCORE** (optional) — Meta score in `think()` only.

Refer to `systemPrompt.ts` for exact wording.

## Coherent multi-step development (operational summary)

1. **Plan before sprawling** — For large creative or multi-file builds, `plan()` locks milestones and “done” criteria even when the user did not number steps.
2. **Closed artifacts** — Especially single-file HTML/JS demos: either one complete document write or a minimal skeleton plus `apply_diff` / `patch_file`. Half-open tags cause rescue spirals.
3. **Read tool errors literally** — `edit_file` content replace on an existing file requires `overwrite:true` or use replacements/diff; repeating the wrong mode wastes rounds.
4. **Dedup retrieval** — One `memory_query` (or equivalent) with the right scope beats three identical calls.
5. **Compress once, resume smart** — After `compress_context()`, re-read only what you need to continue; do not re-fetch the same memory corpus.

## Web fetch, Readability, and JSDOM

When **`AGENT_WEB_READABILITY=1`**, `web_fetch` uses JSDOM + Mozilla Readability for article-style extraction.

- **Not a layout engine** — JSDOM does not render modern CSS like a browser. For visual truth, use Playwright `browser_*` tools.
- **Author CSS stripped before parse** — Inline `<style>`, `<link rel=stylesheet>`, and `<script>` are removed from a copy of the HTML before `new JSDOM(...)`, because `rrweb-cssom` fails on nested/modern CSS and spams `jsdomError`. Readability only needs DOM structure for main content.
- **VirtualConsole** — Residual `jsdomError` events are swallowed for this short-lived parse.

See [Configuration](./configuration.md#web-fetch-and-readability) for environment variables.

## Related documentation

- [Configuration](./configuration.md) — all `AGENT_*` flags.
- [Runtime behavior](./runtime-behavior.md) — world context, reflexion, finalization.
- [Architecture](./architecture.md) — ReAct loop, dispatcher, rule stats.
- [Research quality](./research-quality.md) — web and citation discipline.
