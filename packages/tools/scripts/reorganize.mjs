#!/usr/bin/env node
/**
 * One-shot migration: flat packages/tools/src → family folders.
 * Run from packages/tools: node scripts/reorganize.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../src");

/** basename (no .ts) -> dir relative to src */
const FILE_DIRS = {
  // root (catalog + registrar)
  index: ".",
  tool_catalog: ".",
  tool_activation: ".",
  "tool_catalog.test": ".",

  // shared
  helpers: "shared",
  file_path_guard: "shared",
  network_retry: "shared",
  systemPrompt: "shared",
  "systemPrompt.effort.test": "shared",
  connector_family_map: "shared",
  connector_live_probes: "shared",
  "pdf-parse.d": "shared",

  // families
  breakdown: "families/reasoning",
  reason: "families/reasoning",
  plan: "families/reasoning",
  think: "families/reasoning",
  hypothesize: "families/reasoning",

  context_tools: "families/context",
  recall_compression: "families/context",

  read_file: "families/files",
  write_file: "families/files",
  edit_file: "families/files",
  list_dir: "families/files",
  grep_file: "families/files",
  move_file: "families/files",
  copy_file: "families/files",
  copy_tree: "families/files",
  mkdir_p: "families/files",
  delete_file: "families/files",
  find_files: "families/files",
  multi_file_apply: "families/files",
  path_guard: "families/files",
  file_metadata: "families/files",
  file_write_ops: "families/files",
  file_write_integrity: "families/files",
  html_write_coherence: "families/files",
  "html_write_coherence.test": "families/files",
  "file_tools.test": "families/files",

  run_shell: "families/shell",
  process_manager: "families/shell",
  terminal_tools: "families/shell",
  terminal_runtime: "families/shell",
  terminal_shell_runtime: "families/shell",
  "terminal_shell_runtime.test": "families/shell",
  run_command_with_pty: "families/shell",
  pty_shell_port: "families/shell",

  git_tools: "families/git",
  git_checkpoint: "families/git",
  git_worktree: "families/git",

  task_persistence: "families/tasks",
  feature_checklist: "families/tasks",

  remember_recall: "families/memory",
  search_memory: "families/memory",
  recall_relevant: "families/memory",
  recall_rerank: "families/memory",
  "recall_rerank.test": "families/memory",
  memory_graph: "families/memory",
  memory_consolidate: "families/memory",
  memory_query: "families/memory",
  memory_promote: "families/memory",
  memory_neighbors: "families/memory",
  memory_autolink: "families/memory",
  memory_index: "families/memory",
  consolidate_chat: "families/memory",
  curate_memory: "families/memory",
  restore_memory: "families/memory",
  read_artifact: "families/memory",
  notes_archive: "families/memory",
  "notes_archive.test": "families/memory",
  notes_store: "families/memory",
  "notes_store_scope.test": "families/memory",

  web_fetch: "families/web",
  web_fetch_http: "families/web",
  web_fetch_readability_worker: "families/web",
  web_fetch_serper: "families/web",
  "web_fetch_serper.test": "families/web",
  "web_fetch.test": "families/web",
  web_search: "families/web",
  web_search_ddg: "families/web",
  web_search_serper: "families/web",
  web_search_providers: "families/web",
  web_search_types: "families/web",
  "web_search.test": "families/web",
  http_request: "families/web",
  failure_review: "families/web",
  weather_fetch: "families/web",
  weather_lookup: "families/web",
  "weather_fetch.test": "families/web",
  research_state: "families/web",

  markets_quote: "families/markets",

  ast_grep: "families/code_intel",
  run_tests: "families/code_intel",
  run_lint: "families/code_intel",
  symbol_index: "families/code_intel",
  find_references: "families/code_intel",
  rename_symbol: "families/code_intel",
  execute_code: "families/code_intel",

  browser_tools: "families/browser",
  browser_runtime: "families/browser",
  "browser_tools.test": "families/browser",
  captcha_solve: "families/browser",

  vision_analyze: "families/vision",
  upload_image: "families/vision",

  transcribe_audio: "families/audio",
  speak: "families/audio",
  audio_attachments: "families/audio",
  audio_http_handlers: "families/audio",
  tts_clips: "families/audio",

  vault_tools: "families/vault",
  vault_ingest: "families/vault",
  vault_ingest_entities: "families/vault",
  vault_recall: "families/vault",
  vault_lint: "families/vault",
  vault_embed: "families/vault",
  vault_entity_extract: "families/vault",
  vault_entity_merge: "families/vault",
  "vault_entity_merge.test": "families/vault",
  vault_index: "families/vault",
  vault_store: "families/vault",
  vault_nexus: "families/vault",
  "vault_nexus.test": "families/vault",

  doc_plan: "families/document",
  doc_research_brief: "families/document",
  doc_collect_sources: "families/document",
  doc_select_assets: "families/document",
  doc_generate_chart_data: "families/document",
  doc_compose_chunk: "families/document",
  doc_lint_layout: "families/document",
  doc_repair_chunk: "families/document",
  doc_render_pptx: "families/document",
  doc_render_docx: "families/document",
  doc_render_pdf: "families/document",
  doc_export: "families/document",
  doc_quality_report: "families/document",
  doc_engine: "families/document",
  doc_style_memory: "families/document",

  session_agenda: "families/agenda_scheduler",
  task_scheduler: "families/agenda_scheduler",

  synthesis_run: "families/synthesis",

  independence: "families/independence",

  repo_map: "families/navigation",
  workspace_snapshot: "families/navigation",
  read_file_chunked: "families/navigation",
  read_file_with_imports: "families/navigation",

  set_persona: "families/harness_ui",
  append_persona_living: "families/harness_ui",
  get_runtime_settings: "families/harness_ui",
  set_runtime_settings: "families/harness_ui",
  extract_structured: "families/harness_ui",
  persona_runtime: "families/harness_ui",
  persona_default: "families/harness_ui",
  persona_presets: "families/harness_ui",
  persona_generator: "families/harness_ui",
  persona_generator_stream: "families/harness_ui",
  "persona_generator.test": "families/harness_ui",
  persona_generation_preview: "families/harness_ui",
  persona_artifact_io: "families/harness_ui",
  persona_stream_extract: "families/harness_ui",
  "persona_stream_extract.test": "families/harness_ui",
  "persona_runtime.test": "families/harness_ui",
  email_style_infer: "families/harness_ui",

  liminal_apps: "families/liminal_apps",
  "liminal_apps.test": "families/liminal_apps",

  orchestration: "families/orchestration",
  agent_context_tools: "families/orchestration",
  branch_explore: "families/orchestration",
  branch_evaluate: "families/orchestration",
  verify_contract: "families/orchestration",
  decompose_goal: "families/orchestration",
  dispatch_graph: "families/orchestration",
  refresh_world_context: "families/orchestration",
  query_tool_outputs: "families/orchestration",

  workflow_tools: "families/workflow",

  meta_tools: "families/meta",
  self_telemetry: "families/meta",
  paste_train: "families/meta",
  dynamic_tools: "families/meta",
  plugin_loader: "families/meta",
  ask_user: "families/meta",

  connect_provider: "integrations/core",
  integration_boot: "integrations/core",
  integration_oauth_start: "integrations/core",
  integrations_server: "integrations/core",
  "integrations_server.test": "integrations/core",
  api_connect: "integrations/external_api",
  "api_connect.test": "integrations/external_api",
  api_connections_store: "integrations/external_api",
  mcp_attach: "integrations/external_api",
  "mcp_attach.test": "integrations/external_api",
  mcp_tool_classify: "integrations/external_api",
  "mcp_tool_classify.test": "integrations/external_api",

  google_workspace_boot: "integrations/google",
  google_gmail_send: "integrations/google",
  google_calendar_rest: "integrations/google",
  "google_calendar_rest.test": "integrations/google",
  google_office_rest: "integrations/google",
  "google_office_rest.test": "integrations/google",
  google_office_rest_shared: "integrations/google",
  google_docs_rest: "integrations/google",
  google_docs_build: "integrations/google",
  "google_docs_build.test": "integrations/google",
  google_slides_rest: "integrations/google",
  google_sheets_rest: "integrations/google",
  google_sheets_layout: "integrations/google",
  "google_sheets_layout.test": "integrations/google",
  google_sidecar: "integrations/google",
  "google_sidecar.test": "integrations/google",
  google_mcp_tool_hints: "integrations/google",
  gmail_compose_guard: "integrations/google",
  "gmail_compose_guard.test": "integrations/google",
  gmail_message_body: "integrations/google",
  "gmail_message_body.test": "integrations/google",

  microsoft_365_boot: "integrations/microsoft",
  microsoft_sidecar: "integrations/microsoft",
  microsoft_calendar_rest: "integrations/microsoft",
  microsoft_office_rest: "integrations/microsoft",
  graph_rest: "integrations/microsoft",
  "graph_rest.test": "integrations/microsoft",
  graph_search_rest: "integrations/microsoft",
  outlook_send: "integrations/microsoft",
  "outlook_send.test": "integrations/microsoft",
  onedrive_rest: "integrations/microsoft",
  excel_rest: "integrations/microsoft",
  onenote_rest: "integrations/microsoft",
  teams_rest: "integrations/microsoft",
  planner_rest: "integrations/microsoft",

  github_connect: "integrations/github",
  "github_connect.test": "integrations/github",
  github_boot: "integrations/github",

  slack_rest: "integrations/slack",
  slack_api: "integrations/slack",
  "slack_api.test": "integrations/slack",
  slack_scope_probe: "integrations/slack",
  "slack_scope_probe.test": "integrations/slack",
  slack_upload_v2: "integrations/slack",
  "slack_upload_v2.test": "integrations/slack",

  linear_rest: "integrations/linear",
  linear_rest_extended: "integrations/linear",
  linear_schema: "integrations/linear",
  linear_resolve: "integrations/linear",
  "linear_resolve.test": "integrations/linear",

  notion_rest: "integrations/notion",

  xero_rest: "integrations/xero",

  agentcard_cli: "integrations/agentcard",
  agentcard_tools: "integrations/agentcard",
  "agentcard.test": "integrations/agentcard",
};

function basenameOf(filename) {
  return filename.replace(/\.ts$/, "");
}

function relImport(fromRelDir, toRelPath) {
  let rel = path.relative(fromRelDir, toRelPath).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

function resolveTarget(spec) {
  const base = spec.replace(/^\.\//, "").replace(/\.js$/, "");
  const dir = FILE_DIRS[base];
  if (!dir) {
    throw new Error(`Unknown module: ${base}`);
  }
  return dir === "." ? base : path.join(dir, base).replace(/\\/g, "/");
}

function fixImportsInFile(fileRelPath, content) {
  const fromDir = path.dirname(fileRelPath);
  const replaceSpec = (spec) => {
    const target = resolveTarget(spec);
    const rel = relImport(fromDir, target);
    return rel.endsWith(".js") ? rel : rel + ".js";
  };

  let out = content.replace(/from\s+["'](\.\/[^"']+)["']/g, (_m, spec) => {
    return `from "${replaceSpec(spec)}"`;
  });
  out = out.replace(/import\s*\(\s*["'](\.\/[^"']+)["']\s*\)/g, (_m, spec) => {
    return `import("${replaceSpec(spec)}")`;
  });
  return out;
}

function moveFiles() {
  const rootFiles = fs.readdirSync(SRC).filter((f) => f.endsWith(".ts"));
  const unmapped = [];

  for (const file of rootFiles) {
    const base = basenameOf(file);
    const dir = FILE_DIRS[base];
    if (!dir) {
      unmapped.push(file);
      continue;
    }
    if (dir === ".") continue;

    const destDir = path.join(SRC, dir);
    fs.mkdirSync(destDir, { recursive: true });
    const src = path.join(SRC, file);
    const dest = path.join(destDir, file);
    if (fs.existsSync(dest)) {
      console.warn(`Already exists: ${dest}`);
      continue;
    }
    fs.renameSync(src, dest);
    console.log(`moved ${file} -> ${dir}/`);
  }

  if (unmapped.length) {
    console.error("Unmapped files:", unmapped);
    process.exit(1);
  }
}

function fixAllImports() {
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".ts")) {
        const rel = path.relative(SRC, full).replace(/\\/g, "/");
        const content = fs.readFileSync(full, "utf8");
        const fixed = fixImportsInFile(rel, content);
        if (fixed !== content) fs.writeFileSync(full, fixed);
      }
    }
  }
  walk(SRC);
}

moveFiles();
fixAllImports();
console.log("Done: move + import fix");
