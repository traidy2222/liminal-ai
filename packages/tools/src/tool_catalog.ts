/**
 * Tool families for lazy loading (AGENT_TOOL_LAZY=1).
 * Keep in sync with tools registered in packages/tools/src/index.ts.
 */
import type { AgentHarness, RuntimePreferences, ToolRegistry } from "@liminal/core";
import { effectiveHarnessEnvRaw, resolveHarnessEnvRaw } from "@liminal/core";

/** Tool families: id -> description + member tool names. */
export const TOOL_FAMILIES: Record<string, { description: string; tools: readonly string[] }> = {
  files_edit: {
    description: "Filesystem operations and rollback-safe multi-file apply.",
    tools: [
      // Filesystem ops
      "move_file",
      "copy_file",
      "copy_tree",
      "mkdir_p",
      "delete_file",
      // Rollback-safe orchestration
      "multi_file_apply",
      "path_guard",
    ],
  },
  shell: {
    description: "Shell and background processes.",
    tools: [
      "run_shell",
      "run_background",
      "kill_process",
      "list_processes",
      "read_process_output",
      "run_command_with_pty",
    ],
  },
  git: {
    description: "Git inspection, commits, checkpoints, rollback, and isolated worktrees.",
    tools: ["git_status", "git_diff", "git_log", "git_branch", "git_commit", "git_checkpoint", "git_rollback", "git_worktree"],
  },
  tasks: {
    description: "Checkpoint and resume long tasks.",
    tools: ["task_checkpoint", "resume_task", "feature_checklist"],
  },
  memory_advanced: {
    description:
      "Typed memory CRUD, consolidation, graph, artifacts, plus cross-chat federation (Phase 2): " +
      "scope-aware writes, sibling-chat aware retrieval, semantic neighbor search, and on-demand consolidation.",
    tools: [
      "remember",
      "recall",
      "recall_type",
      "forget",
      "forget_type",
      "memory_stats",
      "search_memory",
      "memory_consolidate",
      "memory_query",
      "memory_graph",
      "read_artifact",
      "memory_promote",
      "memory_neighbors",
      "consolidate_chat",
      "curate_memory",
      "restore_memory",
      "recall_compression",
    ],
  },
  web: {
    description: "HTTP fetch, search, research, failure review.",
    tools: ["web_fetch", "web_search", "weather_lookup", "failure_review", "http_request"],
  },
  markets: {
    description: "Free best-effort market pricing for equities/ETFs, FX, commodities, and crypto.",
    tools: ["markets_quote"],
  },
  code_intel: {
    description: "AST search, tests, lint, symbol index, references, semantic rename.",
    tools: [
      "ast_grep",
      "run_tests",
      "run_lint",
      "symbol_index",
      "find_references",
      "rename_symbol",
      "execute_code",
    ],
  },
  browser: {
    description:
      "Headless Chromium via Playwright: session loop open → snapshot → act(refs) → close. browser_serve_file for local HTML over http://127.0.0.1. browser_wait_for waits for selector/text/URL/idle. browser_extract pulls structured data (tables, links, forms, meta). browser_cookies saves/loads auth sessions.",
    tools: [
      "browser_open",
      "browser_navigate",
      "browser_snapshot",
      "browser_act",
      "browser_close",
      "browser_serve_file",
      "browser_wait_for",
      "browser_extract",
      "browser_cookies",
    ],
  },
  captcha: {
    description: "Solve CAPTCHAs (reCAPTCHA v2/v3, hCaptcha, Turnstile, image) via 2captcha or CapSolver. Auto-detects from browser session and injects token.",
    tools: ["captcha_solve"],
  },
  vision: {
    description: "Sidecar vision analysis (image understanding while Owl remains primary reasoning model).",
    tools: ["vision_analyze", "upload_image"],
  },
  audio: {
    description:
      "Speech-to-text transcription for voice notes, meetings, podcasts, lectures. " +
      "Cheapest configured ASR model by default (Whisper Large V3 Turbo @ $0.04/hour).",
    tools: ["transcribe_audio", "speak"],
  },
  meta: {
    description: "Harness improvement suggestions, insights, self-telemetry, and pattern-store maintenance.",
    tools: ["suggest_improvement", "view_insights", "self_telemetry", "paste_train"],
  },
  reasoning_advanced: {
    description:
      "Advanced planning and execution control: decompose a goal into subgoals, verify progress against execution contracts, " +
      "schedule an intra-round tool dependency DAG, query prior tool outputs, and inspect the research ledger. " +
      "Harness-scoped — only present when running under a full harness.",
    tools: [
      "decompose_goal",
      "verify_contract",
      "dispatch_graph",
      "query_tool_outputs",
      "research_state",
    ],
  },
  dynamic_tools: {
    description: "Create, edit, remove, and list model-defined tools registered at runtime.",
    tools: ["create_tool", "edit_tool", "remove_tool", "list_dynamic_tools"],
  },
  connectors: {
    description:
      "Curated provider integrations: Google Workspace (OAuth) and GitHub (GITHUB_TOKEN) via connect_provider. " +
      "Google & Xero: hosted OAuth via vireondynamics.com (Settings → Integrations). GitHub: PAT in .env.",
    tools: [
      "connect_provider",
      "disconnect_provider",
      "list_connectors",
      "email_style_infer",
      "gmail_create_draft",
      "gmail_send_message",
      "calendar_rest_get_calendar",
      "calendar_rest_list_calendars",
      "calendar_rest_list_settings",
      "calendar_rest_get_setting",
      "calendar_rest_set_timezone",
      "calendar_rest_list_colors",
      "calendar_rest_patch_calendar_list",
      "calendar_rest_subscribe_calendar",
      "calendar_rest_unsubscribe_calendar",
      "calendar_rest_clear_calendar",
      "calendar_rest_freebusy",
      "calendar_rest_list_acl",
      "calendar_rest_set_acl",
      "calendar_rest_list_events",
      "calendar_rest_get_event",
      "calendar_rest_list_instances",
      "calendar_rest_quick_add",
      "calendar_rest_manage_calendar",
      "calendar_rest_insert_event",
      "calendar_rest_patch_event",
      "calendar_rest_replace_event",
      "calendar_rest_delete_event",
      "calendar_rest_move_event",
      "calendar_rest_import_event",
      "calendar_rest_respond_to_event",
      "outlook_send_message",
      "outlook_create_draft",
      "outlook_calendar_rest_list_events",
      "outlook_calendar_rest_create_event",
      "outlook_calendar_rest_find_meeting_times",
      "outlook_calendar_rest_get_schedule",
      "onedrive_rest_list_children",
      "onedrive_rest_upload_file",
      "onedrive_rest_download_file",
      "onedrive_rest_create_share_link",
      "docs_rest_get_document",
      "docs_rest_extract_text",
      "docs_rest_create_document",
      "docs_rest_set_document_style",
      "docs_rest_copy_document",
      "docs_rest_write_blocks",
      "docs_rest_insert_table",
      "docs_rest_insert_image",
      "docs_rest_replace_all_text",
      "docs_rest_format_range",
      "docs_rest_delete_content",
      "docs_rest_batch_update",
      "sheets_rest_get_spreadsheet",
      "sheets_rest_create_spreadsheet",
      "sheets_rest_get_values",
      "sheets_rest_update_values",
      "sheets_rest_append_values",
      "sheets_rest_batch_get_values",
      "sheets_rest_batch_update_values",
      "sheets_rest_clear_values",
      "sheets_rest_batch_update",
      "slides_rest_get_presentation",
      "slides_rest_create_presentation",
      "slides_rest_batch_update",
      "slides_rest_get_page",
      "slides_rest_get_thumbnail",
      "office_rest_export_file",
      "xero_list_organisations",
      "xero_list_invoices",
      "xero_get_invoice",
      "xero_list_contacts",
      "xero_create_invoice",
    ],
  },
  agentcard: {
    description:
      "AgentCard payments: capped single-use virtual cards, @agentcard.email inbox, Base USDC wallet and x402 fetch. " +
      "Requires `npm install -g agentcard` and one-time signup/setup on the sidecar host.",
    tools: [
      "agentcard_whoami",
      "agentcard_signup",
      "agentcard_setup",
      "agentcard_limit",
      "agentcard_limit_request",
      "agentcard_card_request",
      "agentcard_card_list",
      "agentcard_card_get",
      "agentcard_3ds",
      "agentcard_mail_info",
      "agentcard_mail_list",
      "agentcard_mail_get",
      "agentcard_mail_send",
      "agentcard_mail_reply",
      "agentcard_wallet_info",
      "agentcard_wallet_balance",
      "agentcard_wallet_fetch",
      "agentcard_wallet_send",
      "agentcard_support",
    ],
  },
  external_api: {
    description:
      "Connect external services by spec: OpenAPI/Swagger via api_connect, MCP servers via mcp_attach. " +
      "Each connection auto-registers one tool per remote operation (e.g. api_linear_issues_create). " +
      "Connections persist across restarts under ~/.liminal/api_connections/.",
    tools: ["api_connect", "api_disconnect", "api_list", "mcp_attach", "mcp_detach"],
  },
  vault: {
    description: "Obsidian vault read/write/search.",
    tools: [
      "vault_write",
      "vault_read",
      "vault_search",
      "vault_list",
      "vault_links",
      "vault_graph",
      "vault_delete",
      "vault_ingest",
      "vault_ingest_entities",
      "vault_recall",
      "vault_lint",
    ],
  },
  document: {
    description: "Progressive document engine for PPTX/PPX, DOCX, and PDF (IR, composition, lint, repair, render, export, QA).",
    tools: [
      "doc_plan",
      "doc_research_brief",
      "doc_collect_sources",
      "doc_select_assets",
      "doc_generate_chart_data",
      "doc_compose_chunk",
      "doc_lint_layout",
      "doc_repair_chunk",
      "doc_render_pptx",
      "doc_render_docx",
      "doc_render_pdf",
      "doc_export",
      "doc_quality_report",
    ],
  },
  agenda_scheduler: {
    description: "Session agenda (priority list shown in world context) and recurring task scheduler with overdue detection.",
    tools: [
      "agenda_set",
      "agenda_get",
      "agenda_clear",
      "schedule_create",
      "schedule_list",
      "schedule_delete",
      "schedule_run",
    ],
  },
  synthesis: {
    description: "Weekly cross-domain synthesis sub-agent — reads vault notes, finds connections, writes synthesis note.",
    tools: ["synthesis_run"],
  },
  independence: {
    description: "Free-run independence mode — breaks behavioral ruts via forbidden-zone detection and seed-domain divergence.",
    tools: ["breakout_start", "pattern_record", "independence_status"],
  },
  navigation: {
    description: "Repository tree orientation and targeted file search.",
    tools: ["repo_map", "workspace_snapshot", "file_metadata", "find_files", "read_file_chunked", "read_file_with_imports"],
  },
  harness_ui: {
    description: "Persona, runtime settings, structured extraction (requires harness). Image upload lives in the vision family.",
    tools: [
      "set_persona",
      "append_persona_living",
      "get_runtime_settings",
      "set_runtime_settings",
      "extract_structured",
      "hypothesize",
    ],
  },
  liminal_apps: {
    description:
      "Liminal desktop apps — spawn separate OS windows (weather, html widgets, charts, tables) that refresh on a timer. Desktop sidecar only.",
    tools: [
      "list_app_types",
      "list_apps",
      "read_app_html",
      "grep_app_html",
      "preview_app_html",
      "spawn_app",
      "update_app",
      "close_app",
    ],
  },
  orchestration: {
    description: "Sub-agents, critics, shared context, world refresh (requires harness).",
    tools: [
      "spawn_agent",
      "wait_for_agents",
      "cancel_agent",
      "list_agents",
      "verify_result",
      "evidence_critic",
      "path_critic",
      "policy_critic",
      "reflect_debate",
      "branch_explore",
      "branch_evaluate",
      "share_agent_context",
      "read_agent_context",
      "refresh_world_context",
    ],
  },
  workflow: {
    description:
      "Dynamic workflows: plan and run a multi-phase plan that fans out sub-agents, keeping intermediate results out of context. Harness-scoped, root-only.",
    tools: ["plan_workflow", "run_workflow", "workflow_status", "query_workflow"],
  },
};

export interface FamilyActivitySummary {
  family: string;
  description: string;
  active: number;
  total: number;
}

/** Shared family activity summarizer for lazy-loading status views. */
export function summarizeFamilyActivity(registry: ToolRegistry): FamilyActivitySummary[] {
  const active = new Set(registry.getActiveToolNames());
  const out: FamilyActivitySummary[] = [];
  for (const [family, def] of Object.entries(TOOL_FAMILIES)) {
    const present = def.tools.filter((t) => registry.has(t));
    if (present.length === 0) continue;
    out.push({
      family,
      description: def.description,
      active: present.filter((t) => active.has(t)).length,
      total: present.length,
    });
  }
  return out.sort((a, b) => (b.active - a.active) || (a.family < b.family ? -1 : 1));
}

/** Tools always exposed to the model when AGENT_TOOL_LAZY=1 (minimal surface). */
export const CORE_ALWAYS_TOOLS_BASE: readonly string[] = [
  // Reasoning
  "think",
  "breakdown",
  "reason",
  "plan",
  // File surface — read + write essentials only
  "read_file",
  "grep_file",
  "write_file",
  "edit_file",
  "list_dir",
  // Memory — primary retrieval only; write via balanced profile seed
  "recall_relevant",
  // User interaction
  "ask_user",
  // Lazy loading management — always needed to activate anything else
  "list_tool_families",
  "activate_tool_family",
  // Web — read-only, needed in nearly every general task
  "web_search",
  "web_fetch",
];

/** Env-selected always-loaded profile used when AGENT_TOOL_LAZY=1. */
const ALWAYS_TOOLS_PROFILE_ENV = "AGENT_ALWAYS_TOOLS_PROFILE";
const ALWAYS_TOOLS_PROFILES = ["balanced", "knowledge_first", "max_autonomy"] as const;
type AlwaysToolsProfile = (typeof ALWAYS_TOOLS_PROFILES)[number];

// Balanced profile seeds only `remember` — everything else is activation-only.
const BALANCED_MEMORY_RELIABILITY_TOOLS = TOOL_FAMILIES.memory_advanced.tools.filter((t) =>
  ["remember"].includes(t)
);
const BALANCED_VAULT_RELIABILITY_TOOLS: readonly string[] = [];

const KNOWLEDGE_FIRST_TOOLS = [...TOOL_FAMILIES.memory_advanced.tools, ...TOOL_FAMILIES.vault.tools];
const MAX_AUTONOMY_TOOLS = [
  ...KNOWLEDGE_FIRST_TOOLS,
  ...TOOL_FAMILIES.navigation.tools,
  ...TOOL_FAMILIES.markets.tools,
  ...TOOL_FAMILIES.code_intel.tools.filter((t) => ["ast_grep", "symbol_index", "find_references"].includes(t)),
  ...TOOL_FAMILIES.files_edit.tools,
  ...TOOL_FAMILIES.document.tools,
  ...TOOL_FAMILIES.vision.tools,
  // Workflow entry points are visible without activation in max_autonomy so the
  // model can reach for dynamic workflows on big parallel jobs. Filtered against
  // the live registry, so harmless when AGENT_WORKFLOWS is off.
  ...TOOL_FAMILIES.workflow.tools,
];

function resolveAlwaysToolsProfile(): AlwaysToolsProfile {
  const raw = (process.env[ALWAYS_TOOLS_PROFILE_ENV] ?? "balanced").trim().toLowerCase();
  if (ALWAYS_TOOLS_PROFILES.includes(raw as AlwaysToolsProfile)) {
    return raw as AlwaysToolsProfile;
  }
  return "balanced";
}

function getProfileSeedTools(profile: AlwaysToolsProfile): readonly string[] {
  if (profile === "knowledge_first") {
    return KNOWLEDGE_FIRST_TOOLS;
  }
  if (profile === "max_autonomy") {
    return MAX_AUTONOMY_TOOLS;
  }
  // balanced: keep destructive/high-cost tools activation-only.
  return [...BALANCED_MEMORY_RELIABILITY_TOOLS, ...BALANCED_VAULT_RELIABILITY_TOOLS];
}

/** Context tools only exist after registerAllTools(..., harness). */
export const CORE_HARNESS_TOOLS: readonly string[] = [
  "check_context",
  "compress_context",
  "share_agent_context",
  "read_agent_context",
];

function browserAlwaysActiveTools(): readonly string[] {
  if (effectiveHarnessEnvRaw("AGENT_BROWSER_ALWAYS_ACTIVE") !== "1") return [];
  return TOOL_FAMILIES.browser.tools;
}

export function getCoreAlwaysToolNames(
  hasHarness: boolean,
  prefs?: RuntimePreferences | null
): string[] {
  const out: string[] = [
    ...CORE_ALWAYS_TOOLS_BASE,
    ...getProfileSeedTools(resolveAlwaysToolsProfile()),
    ...browserAlwaysActiveTools(),
  ];
  if (hasHarness) {
    out.push(...CORE_HARNESS_TOOLS);
    // Orchestration and harness_ui are activation-only — they're only needed in specific
    // sessions and their schemas cost ~1.5k tokens per call when always loaded.
    // Activate via activate_tool_family("tasks") or activate_tool_family("harness_ui").
  }
  // speak() is voice-mode only (mic session). AgentHarness.syncVoiceModeTools() activates
  // it per send when liveDictation is set — not part of the static lazy always-set.
  return [...new Set(out)];
}

/** Map tool name -> family id (for dispatcher hints). */
export function buildToolToFamilyMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const [familyId, def] of Object.entries(TOOL_FAMILIES)) {
    for (const t of def.tools) {
      if (!m.has(t)) m.set(t, familyId);
    }
  }
  return m;
}

/**
 * After all tools are registered: set family map and optional lazy active seed.
 */
export function applyLazyRegistrationPolicy(registry: ToolRegistry, harness?: AgentHarness | null): void {
  registry.setToolFamilyLookup(buildToolToFamilyMap());
  const prefs = harness?.getRuntimePreferences() ?? null;
  if (resolveHarnessEnvRaw("AGENT_TOOL_LAZY", prefs) === "1") {
    registry.setLazyToolLoading(true);
    const seed = getCoreAlwaysToolNames(!!harness, prefs).filter((n) => registry.has(n));
    registry.seedActiveTools(seed);
  } else {
    registry.setLazyToolLoading(false);
  }
}
