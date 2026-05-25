# Baseline configuration profiles

Copy flags into **Web Settings** or `.agent_runtime_prefs.json` → `harness.env`. Secrets stay in `.env` only.

See [Configuration basics](../start/configuration-basics.md) for precedence.

## Stable local dev

- `AGENT_TOOL_LAZY=1`
- `AGENT_UI_VERBOSITY=normal`

## Safety-sensitive

- `AGENT_SAFETY_JUDGE=1`
- `AGENT_APPROVAL_TIMEOUT_MS=120000`

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
