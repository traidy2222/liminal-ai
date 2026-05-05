# Configuration Reference

Use `.env.example` as canonical source. This document groups major flags by subsystem.

## Core

- `AGENT_API_KEY`
- `AGENT_API_BASE_URL`
- `AGENT_MODEL`
- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `XAI_API_KEY`
- `PORT`
- `AGENT_WORKSPACE_ROOT`
- `AGENT_TOOL_LAZY`
- `AGENT_UI_VERBOSITY`

## Safety and Approval

- `AGENT_SAFETY_JUDGE`
- `AGENT_SAFETY_JUDGE_MODEL`
- `AGENT_APPROVAL_TIMEOUT_MS`
- `AGENT_DESTRUCTIVE_GATE`

## Context and Compression

- `AGENT_RECALL_EVERY_N`
- `AGENT_DISTILL`
- `AGENT_TOOL_BODY_ELIDE`
- `AGENT_TOOL_ELIDE_MIN_CHARS`
- `AGENT_TOOL_ELIDE_KEEP_ROUNDS`

## Memory and Retrieval

- `AGENT_EMBED_MODEL`
- `AGENT_MEMORY_AUTO_EXTRACT`
- `AGENT_MEMORY_GRAPH`
- `AGENT_MEMORY_AUTOLINK`
- `AGENT_MEMORY_AUTOLINK_MODEL`
- `AGENT_QUERY_REWRITE`
- `AGENT_FAST_MODEL`

## Vault

- `AGENT_VAULT_PATH`
- `AGENT_VAULT_AUTO_WRITE` (`off` | `research` | `aggressive`)
- `AGENT_VAULT_DEDUPE`
- `AGENT_VAULT_WRITE_BUDGET`
- `AGENT_VAULT_REQUIRE_LINKS`
- `AGENT_VAULT_OBSERVABILITY`
- `AGENT_VAULT_FIRST_STRICT`
- `AGENT_MEMORY_EPISODE`

## Critics and Reliability

- `AGENT_CRITIC`
- `AGENT_CRITIC_REQUIRE`
- `AGENT_CRITIC_EVIDENCE`
- `AGENT_CRITIC_MIN_TOOLS`
- `AGENT_FAILURE_LOG`
- `AGENT_RATE_LIMIT_MAX_RETRIES`
- `AGENT_TRANSIENT_5XX_MAX_RETRIES`
- `AGENT_RETRY_MAX_DELAY_MS`

## Evaluation and Session Logging

- `AGENT_EVAL_JSON_SINK`
- `AGENT_SESSION_JSONL`
- `AGENT_SESSION_MODE`

## Behavior Notes

- strict vault-first blocking is opt-in (`AGENT_VAULT_FIRST_STRICT=1`)
- default vault auto-write behavior is research-oriented unless explicitly disabled
- latest/current web queries are time-anchored to current year by tool normalization
- conversational self-management persists approved settings into `.agent_runtime_prefs.json`

## Recommended Baseline Profiles

### Stable local dev
- `AGENT_TOOL_LAZY=1`
- `AGENT_UI_VERBOSITY=normal`

### Safety-sensitive
- `AGENT_SAFETY_JUDGE=1`
- `AGENT_DESTRUCTIVE_GATE=balanced`
- `AGENT_APPROVAL_TIMEOUT_MS=120000`

### Research-heavy
- `AGENT_QUERY_REWRITE=1`
- `AGENT_EMBED_MODEL=openai/text-embedding-3-small`
- `AGENT_VAULT_AUTO_WRITE=research`

