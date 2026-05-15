# Troubleshooting

## Build/Runtime Mismatch

Symptom: UI behavior does not reflect recent core/tools code changes.

Fix:
```bash
npm run build -w packages/core
npm run build -w packages/tools
```

Then restart TUI/web process.

## Tool "not loaded for this session"

Symptom: tool call fails with lazy-loading message.

Fix:
- call `list_tool_families`
- call `activate_tool_family` for required family

## Vault Path Issues

Symptom: notes appear in unexpected location or read/write fails.

Fix:
- set `AGENT_VAULT_PATH` to the exact Obsidian vault folder
- verify filesystem permissions
- confirm path separator/format on your OS

## TUI/Web Streaming Artifacts

Symptom: mixed lines, fragment corruption, repaint flicker after long runs.

Fix checklist:
1. ensure latest core/tools/tui/web builds are running
2. verify stream normalization patch presence
3. verify flush-before-structure ordering in UI reducers
4. run long tool-throughput smoke tests

## Time Drift in "Latest" Searches

Symptom: model queries stale years for current-news prompts.

Fix:
- ensure world context injection is active
- ensure web search temporal normalization is present
- keep protocol time-anchor rule enabled

## Excessive Autonomy

Symptom: too much risk tolerance in tool decisions.

Use:
- `AGENT_SAFETY_JUDGE=1`
- stricter `AGENT_APPROVAL_TIMEOUT_MS`

## Missing Approval Prompts

Symptom: destructive tools run without showing approval modal/prompt.

Check:
- whether session was launched with `--yolo`
- whether `AGENT_YOLO=1` is set in the process environment

Fix:
- unset `AGENT_YOLO`
- restart without `--yolo` (`npm run web`, `npm run web:dev`, `npm run tui`)

## Repeated Failure Loops

Symptom: same failing calls repeated with minor wording changes.

Fix:
- verify duplicate-intent suppression in dispatcher
- verify research anti-loop rules in prompt
- review drift/recovery events for replanning behavior

