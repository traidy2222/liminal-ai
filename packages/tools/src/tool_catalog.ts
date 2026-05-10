/**
 * Tool families for lazy loading (AGENT_TOOL_LAZY=1).
 * Keep in sync with tools registered in packages/tools/src/index.ts.
 */
import type { ToolRegistry } from "@liminal/core";

/** Tool families: id -> description + member tool names. */
export const TOOL_FAMILIES: Record<string, { description: string; tools: readonly string[] }> = {
  files_edit: {
    description: "Advanced file editing, filesystem ops, and rollback-safe multi-file refactors.",
    tools: [
      // Legacy single-mode tools (still work; edit_file is preferred)
      "write_file_if_changed",
      "patch_file",
      "apply_diff",
      "search_replace_file",
      "batch_replace",
      "edit_preview",
      // Filesystem ops
      "move_file",
      "copy_file",
      "copy_tree",
      "mkdir_p",
      // Rollback-safe orchestration
      "multi_file_apply",
      "refactor_plan_apply",
      "path_guard",
    ],
  },
  shell: {
    description: "Shell and background processes.",
    tools: ["run_shell", "run_background", "kill_process", "list_processes", "read_process_output"],
  },
  git: {
    description: "Git inspection and commits.",
    tools: ["git_status", "git_diff", "git_log", "git_branch", "git_commit"],
  },
  tasks: {
    description: "Checkpoint and resume long tasks.",
    tools: ["task_checkpoint", "resume_task", "feature_checklist"],
  },
  memory_advanced: {
    description: "Typed memory CRUD, consolidation, graph, artifacts.",
    tools: [
      "remember",
      "recall",
      "recall_type",
      "forget",
      "forget_type",
      "memory_stats",
      "memory_consolidate",
      "memory_query",
      "memory_graph",
      "read_artifact",
    ],
  },
  web: {
    description: "HTTP fetch, search, research, failure review.",
    tools: ["web_fetch", "web_search", "weather_lookup", "web_research", "failure_review"],
  },
  markets: {
    description: "Free best-effort market pricing for equities/ETFs, FX, commodities, and crypto.",
    tools: ["markets_quote"],
  },
  code_intel: {
    description: "AST search, tests, lint, symbol index, references.",
    tools: ["ast_grep", "run_tests", "run_lint", "symbol_index", "find_references", "execute_code"],
  },
  browser: {
    description: "Headless browser (Playwright, env-gated).",
    tools: ["browser_open", "browser_act"],
  },
  vision: {
    description: "Sidecar vision analysis (image understanding while Owl remains primary reasoning model).",
    tools: ["vision_analyze", "upload_image"],
  },
  meta: {
    description: "Harness improvement suggestions and insights.",
    tools: ["suggest_improvement", "view_insights"],
  },
  dynamic_tools: {
    description: "Create, edit, remove, and list model-defined tools registered at runtime.",
    tools: ["create_tool", "edit_tool", "remove_tool", "list_dynamic_tools"],
  },
  mcp: {
    description: "MCP (Model Context Protocol) — discover, connect, and manage external tool servers. mcp_suggest finds the right server; mcp_connect registers its tools natively.",
    tools: ["mcp_suggest", "mcp_connect", "mcp_servers", "mcp_disconnect"],
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
  navigation: {
    description: "Repository tree orientation and targeted file search.",
    tools: ["repo_map", "workspace_snapshot", "file_metadata", "read_file_chunked", "read_file_with_imports"],
  },
  harness_ui: {
    description: "Persona, images, structured extraction (requires harness).",
    tools: ["set_persona", "upload_image", "extract_structured"],
  },
  orchestration: {
    description: "Sub-agents, critics, world refresh (requires harness).",
    tools: [
      "spawn_agent",
      "wait_for_agents",
      "cancel_agent",
      "list_agents",
      "verify_result",
      "evidence_critic",
      "path_critic",
      "policy_critic",
      "refresh_world_context",
    ],
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
  "think",
  "plan",
  // File read surface (2 tools)
  "read_file",
  "grep_file",
  // File write surface (2 tools — write_file for new, edit_file for existing)
  "write_file",
  "edit_file",
  // Navigation
  "list_dir",
  // Memory / knowledge
  "recall_relevant",
  "search_memory",
  "memory_query",
  "vault_search",
  "vault_read",
  "vault_write",
  "ask_user",
  "list_tool_families",
  "activate_tool_family",
  // Dynamic tool creation — always exposed so the model can build tools any time
  "create_tool",
  "edit_tool",
  "remove_tool",
  "list_dynamic_tools",
  // MCP — always exposed; mcp_suggest discovers servers, mcp_connect registers their tools
  "mcp_suggest",
  "mcp_connect",
  "mcp_servers",
  "mcp_disconnect",
  // Web tools are read-only and needed in nearly every general task — always on.
  "web_search",
  "web_fetch",
  "web_research",
  "weather_lookup",
];

/** Env-selected always-loaded profile used when AGENT_TOOL_LAZY=1. */
const ALWAYS_TOOLS_PROFILE_ENV = "AGENT_ALWAYS_TOOLS_PROFILE";
const ALWAYS_TOOLS_PROFILES = ["balanced", "knowledge_first", "max_autonomy"] as const;
type AlwaysToolsProfile = (typeof ALWAYS_TOOLS_PROFILES)[number];

const BALANCED_MEMORY_RELIABILITY_TOOLS = TOOL_FAMILIES.memory_advanced.tools.filter((t) =>
  ["remember", "recall", "recall_type", "memory_stats"].includes(t)
);
const BALANCED_VAULT_RELIABILITY_TOOLS = TOOL_FAMILIES.vault.tools.filter((t) =>
  ["vault_list", "vault_links"].includes(t)
);

const KNOWLEDGE_FIRST_TOOLS = [...TOOL_FAMILIES.memory_advanced.tools, ...TOOL_FAMILIES.vault.tools];
const MAX_AUTONOMY_TOOLS = [
  ...KNOWLEDGE_FIRST_TOOLS,
  ...TOOL_FAMILIES.navigation.tools,
  ...TOOL_FAMILIES.markets.tools,
  ...TOOL_FAMILIES.code_intel.tools.filter((t) => ["ast_grep", "symbol_index", "find_references"].includes(t)),
  ...TOOL_FAMILIES.files_edit.tools,
  ...TOOL_FAMILIES.document.tools,
  ...TOOL_FAMILIES.vision.tools,
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
export const CORE_HARNESS_TOOLS: readonly string[] = ["check_context", "compress_context"];

export function getCoreAlwaysToolNames(hasHarness: boolean): string[] {
  const out: string[] = [...CORE_ALWAYS_TOOLS_BASE, ...getProfileSeedTools(resolveAlwaysToolsProfile())];
  if (hasHarness) {
    out.push(...CORE_HARNESS_TOOLS);
    // Keep orchestration + critics visible without an extra activation step (common root path).
    out.push(...TOOL_FAMILIES.orchestration.tools);
  }
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
export function applyLazyRegistrationPolicy(registry: ToolRegistry, hasHarness: boolean): void {
  registry.setToolFamilyLookup(buildToolToFamilyMap());
  if (process.env["AGENT_TOOL_LAZY"] === "1") {
    registry.setLazyToolLoading(true);
    const seed = getCoreAlwaysToolNames(hasHarness).filter((n) => registry.has(n));
    registry.seedActiveTools(seed);
  } else {
    registry.setLazyToolLoading(false);
  }
}
