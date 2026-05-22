import {
  deriveCategoryTintsFromTheme,
  migratePersonaUiTheme,
  type PersonaCategoryKey,
  type PersonaUiThemeV2,
} from "@liminal/core/persona-ui-theme";
import { categoryColor } from "./personaVars.js";

export type ToolCategory = PersonaCategoryKey;

const CATEGORY_ICONS: Record<ToolCategory, string> = {
  shell: "▶",
  file: "◇",
  web: "◎",
  memory: "◈",
  vault: "⊚",
  code: "◆",
  git: "⌥",
  markets: "◉",
  vision: "◑",
  docs: "▣",
  orchestration: "⟴",
  context: "⊙",
  other: "⚙",
};

export function getToolCategory(name: string): ToolCategory {
  if (/^(run_shell|run_background|kill_process|list_processes|read_process_output)$/.test(name)) {
    return "shell";
  }
  if (
    /^(read_file|write_file|list_dir|apply_diff|patch_file|edit_file|write_file_if_changed|search_replace_file|batch_replace|grep_file|move_file|copy_file|copy_tree|mkdir_p|edit_preview|multi_file_apply|refactor_plan_apply|path_guard|read_file_chunked|read_file_with_imports|file_metadata|workspace_snapshot)$/.test(
      name
    )
  ) {
    return "file";
  }
  if (/^(web_fetch|web_search|weather_lookup)$/.test(name)) return "web";
  if (
    /^(remember|recall|recall_type|recall_relevant|search_memory|forget|forget_type|memory_stats|memory_consolidate|memory_query|memory_graph)$/.test(
      name
    )
  ) {
    return "memory";
  }
  if (name.startsWith("vault_")) return "vault";
  if (/^(ast_grep|symbol_index|find_references|run_tests|run_lint|execute_code|repo_map)$/.test(name)) {
    return "code";
  }
  if (name.startsWith("git_")) return "git";
  if (name.startsWith("markets_")) return "markets";
  if (/^(vision_analyze|upload_image)$/.test(name)) return "vision";
  if (name.startsWith("doc_")) return "docs";
  if (
    /^(spawn_agent|wait_for_agents|cancel_agent|list_agents|verify_result|evidence_critic|path_critic|policy_critic|reflect_debate)$/.test(
      name
    )
  ) {
    return "orchestration";
  }
  if (/^(check_context|compress_context|refresh_world_context)$/.test(name)) return "context";
  return "other";
}

/** Icon + color for a tool (colors from :root CSS vars set by persona theme). */
export function categoryForTool(name: string): { icon: string; color: string } {
  const cat = getToolCategory(name);
  return { icon: CATEGORY_ICONS[cat], color: categoryColor(cat) };
}

export function buildCategoryMeta(
  theme: PersonaUiThemeV2 | null
): Record<ToolCategory, { icon: string; color: string }> {
  const t = migratePersonaUiTheme(theme);
  const tints = deriveCategoryTintsFromTheme(t);
  const out = {} as Record<ToolCategory, { icon: string; color: string }>;
  for (const key of Object.keys(CATEGORY_ICONS) as ToolCategory[]) {
    out[key] = {
      icon: CATEGORY_ICONS[key],
      color: tints[key] ?? categoryColor(key),
    };
  }
  return out;
}
