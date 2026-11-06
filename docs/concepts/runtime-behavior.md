# Runtime Behavior

This document explains how Liminal behaves during real runs.

## Background chat titles

Desktop and web chats use `inclusionai/ling-3.0-tiny` to generate a concise title
after the first successful user turn. After that, a chat becomes eligible for a
title review after four further turns and at least three minutes. The model keeps
the existing title when the current topic still fits. Idle chats make no requests.

Titling runs independently after the reply. It receives at most eight redacted
user/assistant excerpts, each capped at 700 characters; fenced code, tool output,
system instructions and the agent's tool catalog are not sent. Output is capped at
96 tokens with reasoning disabled, a six-second timeout, no automatic retries and
no expensive fallback model. At most two title requests run concurrently. Failed
or invalid responses keep the existing title and back off for fifteen minutes.

Titles and their cadence persist across restarts. Explicitly supplied titles and
Mission Control are preserved; an in-flight result cannot overwrite a manual
change or recreate a deleted chat. Older default or first-message titles migrate
to automatic titles when their chats are used again.

This feature uses the configured OpenRouter connection and leaves the main agent
model unchanged. Other providers skip it. Set `AGENT_CHAT_AUTO_TITLE=0` to disable
the extra model calls, or change `AGENT_CHAT_TITLE_MODEL` to select another
OpenRouter title model. These settings add no instructions to the main prompt.

## Prompt cache and local telemetry

With prompt caching enabled, the main conversation stays on its selected model
and retains its active tool surface across ordinary intent changes. Actual new
capabilities, deliberate model/voice-mode changes and context compaction can still
require a cache warm-up. Older tool results remain unchanged until context-pressure
recovery needs to shrink them. Current-turn runtime state stays outside the rolling
cache boundary.

OpenRouter requests retain a per-chat session ID. After a successful response names
its provider, Liminal prefers that provider for the same model and routing policy.
Adaptive routing sorts by price with soft preferences for provider median latency
of at most one second and output throughput of at least 80 tokens/second. These
are upstream routing preferences, not guaranteed end-to-end response times. Other
strategies remain available; an explicit sort override takes precedence. The
preferences can be adjusted with `AGENT_PROVIDER_PREFERRED_MAX_LATENCY` and
`AGENT_PROVIDER_PREFERRED_MIN_THROUGHPUT` (0 disables either preference).

The successful provider remains preferred across requests and short restarts,
but expires after ten minutes of inactivity so a cold conversation can reassess
price and performance rather than retain an expensive fallback for a full day.
Explicit provider restrictions take precedence, and fallback remains available
when a provider is unavailable.
Cache reuse still depends on the upstream provider retaining its cache.

**Settings → Models/API → Prompt cache** shows measured cached-token share,
requests with any hit, and reporting coverage. `npm run cache:stats` shows the same
local data from the repository. The owner WebSocket command `get_cache_stats`
accepts an optional `chatId`; web exposes authenticated `/api/cache/stats`.

Numeric records persist locally in `~/.liminal/cache_usage.jsonl`, with agent,
auxiliary and title requests separated. Main-agent cache records are also written
to normal session logs without enabling verbose traces. Records include reported
input/cache-write/output tokens, model, provider, reported cost, and main-request
latency and request-shape hashes. They contain no prompts, tool bodies or keys.

Ordinary Q&A and creative prose do not preload advanced memory, vault or document
catalogs based on intent or fuzzy word matches. The balanced startup surface
includes basic memory storage/search; other families remain discoverable. Active
families stay loaded for the conversation rather than shrinking on each reply.

Optional sampled outcome judging skips successful routine chat and memory-only
turns. Local process scores and implicit follow-up feedback still work without
model calls. Substantive work, tool failures and explicit corrections/retries
remain eligible for sampled semantic review; a judge score is advisory, not proof
that an answer is correct.

Automatic durable-memory extraction also skips memory-only/housekeeping turns,
including turns that already called `remember`, avoiding a second model call to
re-extract the same facts. Explicit memory writes and extraction after substantive
tool work remain available.

Web research is browser-first by default. `AGENT_WEB_SEARCH_FETCH=0` removes
`web_search` and `web_fetch` from registration, including family discovery and
activation. It also suppresses `http_request`, `markets_quote` and `weather_lookup`
for ordinary research, including cached activations and dispatch lookup. An explicit
API/HTTP or named-utility request can expose the relevant utility for that user turn;
the next ordinary turn hides it again. Child agents inherit the parent's limits.
Set the setting to 1 to restore direct web/data tools. Internal integration HTTP
helpers remain available. Research preloading and discovery select the browser
when direct lookups are unavailable.
Browser observations include bounded `READABLE_CONTENT` from rendered article/main
text alongside the existing interaction refs, using the same page and login state
without an additional HTTP fetch. Longer pages can be narrowed with `browser_extract`.

`browser_search` runs Google queries in the same selected browser tab, including
quoted phrases and source/date operators. Observations expose bounded observed
link destinations and reading metadata (page kind, rendered/excerpt length and
truncation), not an automatic trust score. The stable research guidance separates
original-source claims from independent corroboration and encourages queries
targeted at missing facts and contrary evidence. Research is no longer forced
through the build-oriented brief reasoning clamp; this does not impose source
counts, final-answer gates or an extra model judge.

When a news-card link is covered by an anchor with the exact same HTTP destination
and target, the browser clicks that real hit target normally. It does not force
clicks through unrelated overlays or dialogs.

Long browser text can be read in bounded windows with `browser_extract`'s
`offset`/`max_chars` and returned `next_offset`. A text query matching a heading
returns that section and its links; links queries filter labels, destinations and
surrounding citation text. Unmatched text queries return available headings. This
avoids guessing CSS selectors or rereading the opening excerpt after scrolling.
Explicit navigation timeouts are honored by both open and navigate tools.
The default navigation timeout is 20 seconds. If the expected source document is
already rendered and readable when its load-state wait times out, it is returned
with an explicit navigation warning; missing or unreadable documents remain errors.

Research extraction results automatically carry the observed URL, page title and
timestamp alongside their data. This metadata is captured in the same document
evaluation as the extracted text, without another model or tool call. It identifies
the source of an observation and does not establish that the source is correct.
Matched rows also carry observed link destinations, rather than requiring guessed
product or article URLs. Search-engine extractions are explicitly tagged as leads.
The answer policy asks for source links and recommendations based on supported
comparisons, with inferences labelled rather than asserted as verified facts.

Routine browser operations omit console/network diagnostics by default. Debugging
can request `include_console=true`, which returns bounded, deduplicated diagnostics.
Snapshot budgets reserve readable text before long control lists can exhaust the
response. Matched passages and selector results are pageable and report clipping;
these limits apply to new outputs without rewriting historical cache prefixes.
Browser-first mode exposes `browser_search` as a small initial entry point; its
first use loads browser follow-up tools. Browser operations within one chat are
queued through tab selection, navigation and observation, including nested tool
helpers. This prevents parallel searches from aborting each other's navigation;
different chats can still operate concurrently. Hinted family discovery returns
the relevant family instead of repeating the full catalog.

Browser recommendations can record batched findings through
`browser_extract(type="findings")`: statement, supporting page quote and an
observation/inference label. The quote must match the current rendered document;
the record includes its observed URL, title and time. Search results remain leads.
These records establish provenance, not automatic verification of the statement's
meaning. Findings are scoped to the chat and retained in its tool transcript;
the in-memory list lasts for the current daemon session.

Missing click targets get a short appearance wait; ambiguous targets return their
labels and observed destinations without clicking. Failure recovery includes fresh
refs. Normal same-page actions and revisits return changed controls/content instead
of repeating unchanged observations. `browser_snapshot` or
`browser_act(full_snapshot=true)` returns a full view. `refresh_snapshot=false`
does not silently include the body anyway. New observations stay append-only;
this does not rewrite conversation history to save tokens.
Missing usage is unknown, not a zero hit; rates use summed cached/input tokens for
reporting responses. The panel reads up to the latest 5,000 completed responses
within an 8 MiB log tail. It is not a complete account-billing ledger and cannot
retroactively recover unrecorded counts or charges for failed/aborted streams.

## World Context Grounding

Root sessions inject a world-context block once per fresh session. It includes:

- current local date/time + timezone
- OS/shell/path conventions
- workspace root and project metadata
- git state
- available tools/signals
- memory/vault summaries
- repo map hints

This anchors model behavior to the actual machine and date.

## Execution State and Long-Horizon Planning

Liminal tracks an `ExecutionState` model containing:

- `mission`
- `milestones`
- `contracts`
- `commitments`
- `driftScore`
- `recoveryLog`

During runs, contract transitions and drift events are emitted for observability and eval assertions.

## Drift and Recovery

Drift score increases via periodic cadence and failure signals. When thresholds are crossed, replanning hints or state transitions can trigger.

When all tools in a round fail:

- error summary is appended
- recovery hints are injected
- recovery action is logged/emitted
- structured reflexion is attempted: calls the configured model to extract `{lesson, root_cause, fix_pattern}` JSON and stores the result as a `reflection:` typed memory note for future sessions. Falls back to plain-text if the model call fails. Controlled by `AGENT_REFLEXION_SEMANTIC` (defaults on).
- `bumpRuleHits()` is called with the error context to increment errors-prevented counters for any R-* rule IDs referenced in the failure.

## Finalization and Critic Pass

Before turn completion, runtime may perform:

- path citation nudges
- synthesis checklist nudges for research outputs
- `verify_result` critic checks for heavy/path-rich completions
- memory auto-extraction
- vault auto-write (policy dependent)

These steps improve output quality and reduce silent regressions.

## Vault Policy Semantics

Current default behavior:

- retrieval order guidance is advisory (memory -> vault -> web)
- auto-write mode defaults to research-oriented persistence (unless disabled)

## Temporal Anchoring

Time-sensitive web queries (`latest/news/current/update`) are normalized to the current year unless the user explicitly asks for historical coverage.

This prevents silent drift into stale years.

## Runtime Heartbeats

Each round can emit heartbeat telemetry including:

- round index
- uptime
- drift score
- active contract id

Heartbeats are used by UI traces and eval assertions for long-horizon health checks.

Elapsed rounds alone do not increase drift or replace the plan. Drift/recovery changes require evidence such as failed tool rounds; procedure dependency invalidation separately checks actual files, schemas and environment. Local dependency checks make no model request, though their status and subsequent model-selected recovery work can add prompt or tool cost.

## Harness protocol rule recall

On **ReAct round 2** of each `send()`, unless `AGENT_RULE_RECALL=0`, the harness appends a system message listing named protocol rules (IDs such as `R-PLAN-3STEPS`, `R-DEDUP-TOOLS`, `R-CLOSED-ARTIFACT`, …) covering planning, citations, deduplicated retrieval, closed HTML artifacts, tool-error hygiene, research budgets, typography, and more. The text is defined in `packages/core/src/harness_rules.ts` and mirrors the spirit of the always-on protocol in `packages/tools/src/systemPrompt.ts`.

Purpose:

- reinforce habits that prevent broken half-files, duplicate `memory_query` loops, and ignored tool error messages
- surface chronically violated rules when `.agent_rule_stats.json` is populated (adaptive builder)

Full rule table and web_fetch Readability notes: **[Harness protocol](./harness-protocol.md)**.

## Conversational Self-Management

The harness can interpret plain-language runtime directives (for example: "from now on use model X") with an internal JSON extraction pass.

Behavior:

- low-risk changes can be applied immediately
- risky policy relaxations require explicit confirmation
- approved changes persist to `.agent_runtime_prefs.json` at workspace root
- persisted preferences are loaded at startup by TUI/web/eval entrypoints

Preference precedence:

1. in-turn explicit user directive
2. persisted runtime preferences
3. environment configuration
4. hardcoded defaults

