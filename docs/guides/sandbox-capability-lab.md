# Sandbox capability lab

The **sandbox capability lab** runs real harness tool chains in **isolated temp workspaces** so you can see where the agent fails without polluting the monorepo or `~/.liminal`.

Each scenario copies a seeded fixture into a throwaway directory, pins `AGENT_WORKSPACE_ROOT` there (legacy layout for isolated `.agent_notes.json`), and checks **on-disk oracles** in addition to trace assertions.

## Run it

```bash
npm run build
npm run eval:sandbox -w packages/eval
npm run eval -w packages/eval -- --only sandbox-read-edit-verify
node scripts/sandbox-lab-report.mjs
```

**Default stack** (sandbox-lab): Vireon **managed inference** on **Bedrock** — `zai.glm-5` main, `zai.glm-4.7-flash` fast. Requires `liminal login` (admin/Pro license) or `AGENT_API_KEY` in `.env`.

Override: `EVAL_MODEL`, `EVAL_FAST_MODEL`, or `AGENT_MANAGED_PROVIDER`.

## Scenarios

| Scenario | What it exercises |
| -------- | ----------------- |
| `sandbox-read-edit-verify` | `read_file` → `edit_file`, typo fix on disk |
| `sandbox-run-lint-fix` | `run_lint` (tsc) → `edit_file` → re-lint |
| `sandbox-mini-repo-read` | `read_file` + grounded answer |
| `sandbox-execute-code` | `execute_code` (JavaScript) |
| `sandbox-shell-boundary` | `run_shell` cwd stays inside sandbox |
| `sandbox-memory-isolated` | `remember` / `recall` → `notes.json` in temp root only |
| `sandbox-write-two-files` | Two `write_file` calls, both files on disk |

## Adding scenarios

1. Add a fixture folder under `packages/eval/fixtures/sandbox/<name>/`.
2. Add a scenario in `packages/eval/src/scenarios/sandbox_capability_lab.ts` with `sandboxFixture: "<name>"`.
3. Use `readSandboxText(ctx, "relative/path")` for filesystem oracles — `ctx.sandboxRoot` is set automatically.

Results append to `.agent_eval_runs/runs.jsonl` like other eval packs (`AGENT_EVAL_JSON_SINK=1` by default).

## Why this exists

The main eval suite runs against the **real monorepo** — great for integration, bad for repeatable side-effect tests. The sandbox lab closes that gap: same `AgentHarness` + `registerAllTools`, but every run is disposable and assertions can verify **what actually changed on disk**.
