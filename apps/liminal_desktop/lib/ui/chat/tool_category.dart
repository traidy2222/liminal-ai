import 'package:flutter/material.dart';

import '../theme/liminal_tokens.dart';

enum ToolCategory {
  shell,
  file,
  web,
  memory,
  vault,
  code,
  git,
  markets,
  vision,
  docs,
  orchestration,
  context,
  other,
}

/// Tool name → category (web `categoryMeta.ts` parity).
ToolCategory toolCategoryFor(String name) {
  if (RegExp(r'^(run_shell|run_background|kill_process|list_processes|read_process_output)$')
      .hasMatch(name)) {
    return ToolCategory.shell;
  }
  if (RegExp(
    r'^(read_file|write_file|list_dir|apply_diff|patch_file|edit_file|write_file_if_changed|search_replace_file|batch_replace|grep_file|move_file|copy_file|copy_tree|mkdir_p|edit_preview|multi_file_apply|refactor_plan_apply|path_guard|read_file_chunked|read_file_with_imports|file_metadata|workspace_snapshot)$',
  ).hasMatch(name)) {
    return ToolCategory.file;
  }
  if (RegExp(r'^(web_fetch|web_search|weather_lookup)$').hasMatch(name)) {
    return ToolCategory.web;
  }
  if (RegExp(
    r'^(remember|recall|recall_type|recall_relevant|search_memory|forget|forget_type|memory_stats|memory_consolidate|memory_query|memory_graph)$',
  ).hasMatch(name)) {
    return ToolCategory.memory;
  }
  if (name.startsWith('vault_')) return ToolCategory.vault;
  if (RegExp(r'^(ast_grep|symbol_index|find_references|run_tests|run_lint|execute_code|repo_map)$')
      .hasMatch(name)) {
    return ToolCategory.code;
  }
  if (name.startsWith('git_')) return ToolCategory.git;
  if (name.startsWith('markets_')) return ToolCategory.markets;
  if (RegExp(r'^(vision_analyze|upload_image)$').hasMatch(name)) {
    return ToolCategory.vision;
  }
  if (name.startsWith('doc_')) return ToolCategory.docs;
  if (RegExp(
    r'^(spawn_agent|wait_for_agents|cancel_agent|list_agents|verify_result|evidence_critic|path_critic|policy_critic|reflect_debate)$',
  ).hasMatch(name)) {
    return ToolCategory.orchestration;
  }
  if (RegExp(r'^(check_context|compress_context|refresh_world_context)$').hasMatch(name)) {
    return ToolCategory.context;
  }
  return ToolCategory.other;
}

IconData toolCategoryIcon(ToolCategory cat) => switch (cat) {
      ToolCategory.shell => Icons.terminal,
      ToolCategory.file => Icons.description_outlined,
      ToolCategory.web => Icons.language,
      ToolCategory.memory => Icons.psychology_outlined,
      ToolCategory.vault => Icons.lock_outline,
      ToolCategory.code => Icons.code,
      ToolCategory.git => Icons.account_tree_outlined,
      ToolCategory.markets => Icons.show_chart,
      ToolCategory.vision => Icons.image_search_outlined,
      ToolCategory.docs => Icons.article_outlined,
      ToolCategory.orchestration => Icons.hub_outlined,
      ToolCategory.context => Icons.compress,
      ToolCategory.other => Icons.build_outlined,
    };

Color toolCategoryColor(ToolCategory cat, LiminalTokens lim) => switch (cat) {
      ToolCategory.shell => lim.accent,
      ToolCategory.file => lim.secondary,
      ToolCategory.web => lim.accent.withValues(alpha: 0.85),
      ToolCategory.memory => lim.warn,
      ToolCategory.vault => lim.muted,
      ToolCategory.code => lim.success,
      ToolCategory.git => lim.secondary,
      ToolCategory.markets => lim.warn,
      ToolCategory.vision => lim.accent,
      ToolCategory.docs => lim.textMuted,
      ToolCategory.orchestration => lim.accent,
      ToolCategory.context => lim.textDim,
      ToolCategory.other => lim.textMuted,
    };
