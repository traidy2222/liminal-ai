# Tool families (lazy loading)

When `AGENT_TOOL_LAZY=1`, only a baseline subset is registered at startup. Activate more with `activate_tool_family` or `list_tool_families`.

Authoritative catalog: `packages/tools/src/tool_catalog.ts`. Registration: `packages/tools/src/index.ts`.

## Families (summary)

| Family | Examples |
|--------|----------|
| `files_edit` | `read_file`, `write_file`, `patch_file`, `apply_diff`, … |
| `shell` | `run_shell`, `run_background`, `run_command_with_pty`, … |
| `git` | `git_status`, `git_diff`, `git_commit`, … |
| `memory_advanced` | `recall_relevant`, `memory_query`, `read_artifact`, … |
| `vault` | `vault_write`, `vault_read`, `vault_search`, … |
| `web` | `web_search`, `web_fetch` (no `web_research`) |
| `code_intel` | `ast_grep`, `symbol_index`, `run_tests`, … |
| `browser` | `browser_open`, `browser_act` |
| `harness_ui` | `check_context`, `compress_context`, orchestration tools |
| `document` | `doc_*` pipeline (gate: `AGENT_DOC_ENGINE=1`) |

## Research pattern

Use `web_search` + `web_fetch` — [Research with web tools](../../guides/research-with-web-tools.md).

## Contributor map

Full per-file table: repository root `CLAUDE.md` (packages/tools section).
