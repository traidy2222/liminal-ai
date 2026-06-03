# Baseline configuration profiles

Copy flags into **Web Settings** or `.agent_runtime_prefs.json` → `harness.env`. Secrets stay in `.env` only.

See [Configuration basics](../start/configuration-basics.md) for precedence.

## Stable local dev

- `AGENT_TOOL_LAZY=1`
- `AGENT_UI_VERBOSITY=normal`
- `AGENT_TOOL_BODY_ELIDE=1` and `AGENT_DISTILL=1` (product defaults — stale tool bodies become pointers; huge non-code outputs distill)
- `AGENT_REASONING_DEFAULT_EFFORT=medium`
- `AGENT_COMPLEXITY_ROUTING=1`

## Safety-sensitive

- `AGENT_SAFETY_JUDGE=1`
- `AGENT_APPROVAL_TIMEOUT_MS=120000`

## Autonomous long-run (trusted local)

For migrations and multi-hour jobs — pair with `liminal web --yolo` or `AGENT_YOLO=1`:

- `AGENT_SEND_TIMEOUT_MS=7200000`
- `AGENT_WORKFLOW_TIMEOUT_MS=7200000`
- `AGENT_CHILD_TIMEOUT_MS=1800000`
- `AGENT_WORKFLOWS=1`
- `AGENT_ALWAYS_TOOLS_PROFILE=max_autonomy`
- `AGENT_SELF_HEAL_LINT=1`
- `AGENT_YIELD_EVERY_N=8`
- `AGENT_SESSION_MODE=coding`
- `AGENT_COMPENSATION_ENABLED=1`
- `AGENT_MISSION_AUTONOMY=1` (chains sends while `task:*` stays `in_progress`; requires YOLO)
- `AGENT_CONSOLIDATE_ON_IDLE=1` (fold session learnings on chat reset)
- `AGENT_AUTO_APPROVE_TOOLS=run_lint,run_tests,git_status` (optional middle ground without full YOLO)

## YOLO (high-risk, temporary)

- `AGENT_YOLO=1`
- Prefer session-bound CLI flags:
  - `npm run web -- --yolo`
  - `npm run web:dev -- --yolo`
  - `npm run tui -- --yolo`

## Research-heavy

- `AGENT_QUERY_REWRITE=1`
- `AGENT_EMBED_MODEL=openai/text-embedding-3-small` (or your provider’s embedding slug)
- `AGENT_VAULT_AUTO_WRITE=research`
- `AGENT_WEB_READABILITY=1`

Workflow: [Harness protocol — Web research](../concepts/harness-protocol.md#web-research-no-web_research-tool).

## Long-session / deep reasoning

- `AGENT_COMPRESS_SEMANTIC=1`
- `AGENT_REFLEXION_SEMANTIC=1` (default on)
- `AGENT_PROTOCOL_INTENT_HINT=coding` (adjust to task class: `knowledge`, `execution`, `introspection`)

## Plugin extensions

- `AGENT_PLUGIN_DIR=/absolute/path/to/plugins`
