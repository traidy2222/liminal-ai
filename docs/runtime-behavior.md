# Runtime Behavior

This document explains how Liminal behaves during real runs.

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
- strict blocking before `web_search` is opt-in (`AGENT_VAULT_FIRST_STRICT=1`)
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

