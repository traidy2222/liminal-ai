# Tool families (lazy loading)

When `AGENT_TOOL_LAZY=1` (default), only a baseline subset is registered at startup. Activate more with `activate_tool_family`, `breakdown` (declares families for pre-activation), or `list_tool_families`.

**Always loaded (baseline):** `read_file`, `write_file`, `edit_file`, `list_dir`, `grep_file`, `think`, `reason`, `plan`, `breakdown`, and related core navigation tools.

**Activation-only example — `files_edit` family:** `move_file`, `copy_file`, `multi_file_apply`, `path_guard`, … (not the core read/write tools).

Authoritative catalog: `packages/tools/src/tool_catalog.ts`. Registration: `packages/tools/src/index.ts`.

## Families (summary)

| Family | Examples |
|--------|----------|
| `files_edit` | `move_file`, `copy_file`, `copy_tree`, `mkdir_p`, `multi_file_apply`, `path_guard` |
| `shell` | `run_shell`, `run_background`, `run_command_with_pty`, … |
| `git` | `git_status`, `git_diff`, `git_commit`, `git_checkpoint`, `git_rollback`, … |
| `memory_advanced` | `recall_relevant`, `memory_query`, `read_artifact`, `memory_graph`, … |
| `vault` | `vault_write`, `vault_read`, `vault_search`, … |
| `web` | `web_search`, `web_fetch` |
| `code_intel` | `ast_grep`, `symbol_index`, `run_tests`, `run_lint`, … |
| `browser` | `browser_open`, `browser_act`, `browser_snapshot`, … |
| `harness_ui` | `check_context`, `compress_context`, orchestration tools |
| `document` | `doc_*` pipeline (gate: `AGENT_DOC_ENGINE=1`) |

## Web research

Use **`web_search` + `web_fetch`** — see [Harness protocol — Web research](../../concepts/harness-protocol.md#web-research-no-web_research-tool).

## Contributors

Full per-file map: repository root `CLAUDE.md` (packages/tools section). Eval scenarios: `npm run eval -w packages/eval`.
