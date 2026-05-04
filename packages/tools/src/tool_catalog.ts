/**
 * Tool families for lazy loading (AGENT_TOOL_LAZY=1).
 * Keep in sync with tools registered in packages/tools/src/index.ts.
 */
import type { ToolRegistry } from "@liminal/core";

/** Tool families: id -> description + member tool names. */
export const TOOL_FAMILIES: Record<string, { description: string; tools: readonly string[] }> = {
  files_edit: {
    description: "Write and patch files (destructive edits).",
    tools: ["write_file", "patch_file", "apply_diff"],
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
    tools: ["task_checkpoint", "resume_task"],
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
    tools: ["web_fetch", "web_search", "web_research", "failure_review"],
  },
  code_intel: {
    description: "AST search, tests, lint, symbol index, references.",
    tools: ["ast_grep", "run_tests", "run_lint", "symbol_index", "find_references"],
  },
  browser: {
    description: "Headless browser (Playwright, env-gated).",
    tools: ["browser_open", "browser_act"],
  },
  meta: {
    description: "Harness improvement suggestions and insights.",
    tools: ["suggest_improvement", "view_insights"],
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
  navigation: {
    description: "Repository tree orientation.",
    tools: ["repo_map"],
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

/** Tools always exposed to the model when AGENT_TOOL_LAZY=1 (minimal surface). */
export const CORE_ALWAYS_TOOLS_BASE: readonly string[] = [
  "think",
  "plan",
  "read_file",
  "list_dir",
  "recall_relevant",
  "search_memory",
  "ask_user",
  "list_tool_families",
  "activate_tool_family",
];

/** Context tools only exist after registerAllTools(..., harness). */
export const CORE_HARNESS_TOOLS: readonly string[] = ["check_context", "compress_context"];

export function getCoreAlwaysToolNames(hasHarness: boolean): string[] {
  const out: string[] = [...CORE_ALWAYS_TOOLS_BASE];
  if (hasHarness) {
    out.push(...CORE_HARNESS_TOOLS);
    // Keep orchestration + critics visible without an extra activation step (common root path).
    out.push(...TOOL_FAMILIES.orchestration.tools);
  }
  return out;
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
