# Tool families

Liminal ships **140+ tools**. With `AGENT_TOOL_LAZY=1` (default) only a baseline subset is
registered at startup; the model activates more **families** on demand. This keeps the tool
list the model reasons over small and relevant.

- **Discover:** `list_tool_families` (pass a `task_hint` to get suggestions).
- **Activate:** `activate_tool_family("<family>")` loads a whole family into the live registry.
- **Pre-declare:** `breakdown` can declare the families a plan will need so they pre-activate.

Baseline set is chosen by `AGENT_ALWAYS_TOOLS_PROFILE` (`balanced` default · `knowledge_first`
· `max_autonomy`). Authoritative catalog: `packages/tools/src/tool_catalog.ts`; registration:
`packages/tools/src/index.ts`. Every registered tool belongs to a family or the always-set
(enforced by `tool_catalog.test.ts`).

> See [Lazy tool loading](#troubleshooting-inactive-tools) below if a tool you expect isn't
> available, and [Configuration](../../configuration.md) for the gating env keys.

## Always loaded (baseline)

These are registered up front in every session — code is the agent's substrate, so reading,
editing, navigating, and reasoning never wait on activation.

| Group | Tools |
| ----- | ----- |
| Reasoning | `think`, `reason`, `plan`, `hypothesize`, `breakdown` |
| Read & navigate | `read_file`, `read_file_chunked`, `read_file_with_imports`, `file_metadata`, `list_dir`, `grep_file`, `find_files`, `repo_map`, `workspace_snapshot` |
| Write | `write_file` (create/overwrite/append), `edit_file` (replacements or fuzzy diff) |
| Meta (always) | `list_tool_families`, `activate_tool_family`, `api_connect`/`api_list`, `mcp_attach`/`mcp_detach` |

## Family catalog

| Family | What it adds | Notable gate |
| ------ | ------------ | ------------ |
| `files_edit` | `move_file`, `copy_file`, `copy_tree`, `mkdir_p`, `delete_file` (approval-gated), `multi_file_apply` (atomic, rollback), `path_guard` | — |
| `shell` | `run_shell` (destructive, approval-gated), `run_background`, `kill_process`, `list_processes`, `read_process_output`, `run_command_with_pty`, `execute_code` | — |
| `code_intel` | `ast_grep`, `symbol_index`, `find_references`, `rename_symbol` (project-wide TS/JS rename), `run_tests`, `run_lint` | — |
| `git` | `git_status`, `git_diff`, `git_log`, `git_branch`, `git_commit`, `git_checkpoint`, `git_rollback`, `git_worktree` | — |
| `web` | `web_search`, `web_fetch`, `http_request`, `weather_lookup` | — |
| `markets` | `markets_quote` | `AGENT_MARKETS_ENABLE` |
| `browser` | `browser_open/navigate/snapshot/act/extract/wait_for/cookies/close`, `browser_serve_file` | `AGENT_BROWSER` |
| `captcha` | `captcha_solve` | `AGENT_CAPTCHA_KEY` |
| `vision` | `vision_analyze`, `upload_image` | `AGENT_VISION_*` |
| `audio` | `speak` (TTS), `transcribe_audio` | `AGENT_TTS_ENABLED` / `AGENT_TRANSCRIBE_ENABLED` |
| `memory_advanced` | `recall_relevant`, `memory_query`, `memory_graph`, `memory_consolidate`, `curate_memory`, `restore_memory`, `memory_promote`, `memory_neighbors`, `consolidate_chat`, `read_artifact`, `failure_review` | — |
| `vault` | `vault_write/read/search/list/links/graph/delete` | — |
| `document` | `doc_plan` → `doc_*` → `doc_render_pptx/docx/pdf` → `doc_export` | `AGENT_DOC_ENGINE` |
| `tasks` | `task_checkpoint`, `resume_task`, `feature_checklist`, `pattern_record` | — |
| `agenda_scheduler` | `agenda_set/get/clear`, `schedule_create/list/delete/run` | — |
| `meta` | `suggest_improvement`, `view_insights`, `self_telemetry`, dynamic-tool + connector tools | — |
| `dynamic_tools` | `create_tool`, `edit_tool`, `remove_tool`, `list_dynamic_tools` | — |
| `external_api` | `api_<conn>_<op>` (from `api_connect`), `mcp_<conn>_<tool>` (from `mcp_attach`) | — |
| `reasoning_advanced` | `decompose_goal`, `verify_contract`, `dispatch_graph`, `query_tool_outputs`, `research_state` | harness-scoped |
| `synthesis` | `synthesis_run` (cross-domain synthesis sub-agent) | harness-scoped |
| `orchestration` | `spawn_agent`, `wait_for_agents`, `cancel_agent`, `list_agents`, `verify_result`, `evidence_critic`, `path_critic`, `policy_critic`, `reflect_debate`, `branch_explore`, `branch_evaluate` | harness-scoped |
| `workflow` | `plan_workflow`, `run_workflow`, `workflow_status`, `query_workflow` | root-only, `AGENT_WORKFLOWS` |
| `navigation` | extended repo/file navigation helpers | — |
| `independence` | `breakout_start`, `independence_status` | — |
| `harness_ui` | `check_context`, `compress_context`, `get/set_runtime_settings`, `set_persona`, `refresh_world_context` | harness-scoped |

**Harness-scoped families** are recreated per child agent via `onChildCreated` (never copied
parent → child). Root-only families (`workflow`) are excluded from children so workflows can't
nest. See [Sub-agents & orchestration](../../guides/sub-agents-and-orchestration.md) and
[Dynamic workflows](../../guides/dynamic-workflows.md).

## Feature deep-dives

| Area | Guide |
| ---- | ----- |
| Web research (`web_search` + parallel `web_fetch`) | [Web research](../../guides/web-research.md) |
| Browser automation (Playwright) | [Browser automation](../../guides/browser-automation.md) |
| Memory, recall, vault | [Memory & recall](../../guides/memory-and-recall.md) |
| Documents (PPTX/DOCX/PDF) | [Document engine](../../guides/document-engine.md) |
| Voice (TTS + dictation) | [Voice](../../guides/voice.md) |
| Parallel sub-agents | [Sub-agents & orchestration](../../guides/sub-agents-and-orchestration.md) |
| Multi-phase fan-out | [Dynamic workflows](../../guides/dynamic-workflows.md) |
| External APIs / MCP | `api_connect` (OpenAPI 3.x) · `mcp_attach` (Streamable-HTTP MCP) |

## Troubleshooting inactive tools

If the model reports a tool isn't available under lazy loading:

1. `list_tool_families` (pass a `task_hint`) to see families and what they hold.
2. `activate_tool_family("<best-fit family>")` — one family, not many.
3. Retry the exact tool with corrected args.

Never activate the same family twice on one registry — `tool_catalog.ts` tracks activated
families. To keep a family always-on (e.g. `browser`), set its always-active env flag or use
the `max_autonomy` profile.

## Contributors

Full per-file map: repository root `CLAUDE.md` (packages/tools section). Eval scenarios:
`npm run eval -w packages/eval`.
