import type { ToolRegistry, AgentEmitter, AgentHarness } from "@liminal/core";
import { readFileTool } from "./read_file.js";
import { writeFileTool } from "./write_file.js";
import { listDirTool } from "./list_dir.js";
import { createRunShellTool } from "./run_shell.js";
import { webFetchTool } from "./web_fetch.js";
import { webSearchTool } from "./web_search.js";
import { weatherLookupTool } from "./weather_lookup.js";
import { marketsQuoteTool } from "./markets_quote.js";
import { createAskUserTool } from "./ask_user.js";
import { rememberTool, recallTool, recallByTypeTool, forgetTool, forgetTypeTool, memoryStatsTool } from "./remember_recall.js";
import { thinkTool } from "./think.js";
import { planTool } from "./plan.js";
import { searchMemoryTool } from "./search_memory.js";
import { recallRelevantTool } from "./recall_relevant.js";
import { memoryGraphTool } from "./memory_graph.js";
import { readArtifactTool } from "./read_artifact.js";
import { webResearchTool } from "./web_research.js";
import { failureReviewTool } from "./failure_review.js";
import { repoMapTool } from "./repo_map.js";
import { memoryConsolidateTool } from "./memory_consolidate.js";
import { memoryQueryTool } from "./memory_query.js";
import { astGrepTool } from "./ast_grep.js";
import { applyDiffTool } from "./apply_diff.js";
import { runTestsTool } from "./run_tests.js";
import { runLintTool } from "./run_lint.js";
import { symbolIndexTool } from "./symbol_index.js";
import { findReferencesTool } from "./find_references.js";
import { executeCodeTool } from "./execute_code.js";
import { readFileChunkedTool } from "./read_file_chunked.js";
import { readFileWithImportsTool } from "./read_file_with_imports.js";
import { fileMetadataTool } from "./file_metadata.js";
import { workspaceSnapshotTool } from "./workspace_snapshot.js";
import { searchReplaceFileTool } from "./search_replace_file.js";
import { batchReplaceTool } from "./batch_replace.js";
import { grepFileTool } from "./grep_file.js";
import { editFileTool } from "./edit_file.js";
import { writeFileIfChangedTool } from "./write_file_if_changed.js";
import { moveFileTool } from "./move_file.js";
import { copyFileTool } from "./copy_file.js";
import { copyTreeTool } from "./copy_tree.js";
import { mkdirPTool } from "./mkdir_p.js";
import { editPreviewTool } from "./edit_preview.js";
import { multiFileApplyTool } from "./multi_file_apply.js";
import { refactorPlanApplyTool } from "./refactor_plan_apply.js";
import { pathGuardTool } from "./path_guard.js";
import { browserOpenTool, browserActTool } from "./browser_tools.js";
import { createOrchestrationTools } from "./orchestration.js";
import {
  runBackgroundTool,
  killProcessTool,
  listProcessesTool,
  readProcessOutputTool,
} from "./process_manager.js";
import { suggestImprovementTool, viewInsightsTool } from "./meta_tools.js";
import { createContextTools } from "./context_tools.js";
import { createRefreshWorldContextTool } from "./refresh_world_context.js";
import { createSetPersonaTool } from "./set_persona.js";
import { createToolDiscoveryTools } from "./tool_activation.js";
import { applyLazyRegistrationPolicy } from "./tool_catalog.js";
// New tools — Upgrade VI (harness quality)
import { agendaSetTool, agendaGetTool, agendaClearTool } from "./session_agenda.js";
import { breakoutStartTool, patternRecordTool, independenceStatusTool } from "./independence.js";
import {
  scheduleCreateTool,
  scheduleListTool,
  scheduleDeleteTool,
  scheduleRunTool,
} from "./task_scheduler.js";
import { createSynthesisRunTool } from "./synthesis_run.js";
// New tools — Upgrade V
import { createDecomposeGoalTool } from "./decompose_goal.js";
import { createBranchExploreTool } from "./branch_explore.js";
import { createVerifyContractTool } from "./verify_contract.js";
import { createDynamicToolsTools, loadDynamicTools } from "./dynamic_tools.js";
// New tools — Upgrade IV
import { gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool } from "./git_tools.js";
import { gitCheckpointTool, gitRollbackTool } from "./git_checkpoint.js";
import { patchFileTool } from "./patch_file.js";
import { taskCheckpointTool, resumeTaskTool } from "./task_persistence.js";
import { featureChecklistTool } from "./feature_checklist.js";
import { createExtractStructuredTool } from "./extract_structured.js";
import { createUploadImageTool } from "./upload_image.js";
import { visionAnalyzeTool } from "./vision_analyze.js";
import { docPlanTool } from "./doc_plan.js";
import { docResearchBriefTool } from "./doc_research_brief.js";
import { docCollectSourcesTool } from "./doc_collect_sources.js";
import { docSelectAssetsTool } from "./doc_select_assets.js";
import { docGenerateChartDataTool } from "./doc_generate_chart_data.js";
import { docComposeChunkTool } from "./doc_compose_chunk.js";
import { docLintLayoutTool } from "./doc_lint_layout.js";
import { docRepairChunkTool } from "./doc_repair_chunk.js";
import { docRenderPptxTool } from "./doc_render_pptx.js";
import { docRenderDocxTool } from "./doc_render_docx.js";
import { docRenderPdfTool } from "./doc_render_pdf.js";
import { docExportTool } from "./doc_export.js";
import { docQualityReportTool } from "./doc_quality_report.js";
// Obsidian brain — vault tools
import {
  vaultWriteTool,
  vaultReadTool,
  vaultSearchTool,
  vaultListTool,
  vaultLinksTool,
  vaultGraphTool,
  vaultDeleteTool,
} from "./vault_tools.js";

/**
 * Register all tools onto a registry.
 * Pass `harness` to also register orchestration tools + context tools scoped to that harness.
 */
export async function registerAllTools(
  registry: ToolRegistry,
  emitter: AgentEmitter,
  harness?: AgentHarness
): Promise<void> {
  registry.register(thinkTool);
  registry.register(planTool);
  registry.register(readFileTool);
  registry.register(readFileChunkedTool);
  registry.register(readFileWithImportsTool);
  registry.register(fileMetadataTool);
  registry.register(workspaceSnapshotTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(writeFileIfChangedTool);
  registry.register(patchFileTool);
  registry.register(searchReplaceFileTool);
  registry.register(batchReplaceTool);
  registry.register(grepFileTool);
  registry.register(moveFileTool);
  registry.register(copyFileTool);
  registry.register(copyTreeTool);
  registry.register(mkdirPTool);
  registry.register(editPreviewTool);
  registry.register(multiFileApplyTool);
  registry.register(refactorPlanApplyTool);
  registry.register(pathGuardTool);
  registry.register(listDirTool);
  registry.register(repoMapTool);
  registry.register(createRunShellTool(emitter));
  registry.register(runBackgroundTool);
  registry.register(killProcessTool);
  registry.register(listProcessesTool);
  registry.register(readProcessOutputTool);
  registry.register(webFetchTool);
  registry.register(webSearchTool);
  registry.register(weatherLookupTool);
  if (process.env["AGENT_MARKETS_ENABLE"] !== "0") {
    registry.register(marketsQuoteTool);
  }
  registry.register(createAskUserTool(emitter));
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  registry.register(gitLogTool);
  registry.register(gitBranchTool);
  registry.register(gitCommitTool);
  registry.register(gitCheckpointTool);
  registry.register(gitRollbackTool);
  registry.register(taskCheckpointTool);
  registry.register(resumeTaskTool);
  registry.register(featureChecklistTool);
  registry.register(rememberTool);
  registry.register(recallTool);
  registry.register(recallByTypeTool);
  registry.register(forgetTool);
  registry.register(forgetTypeTool);
  registry.register(memoryStatsTool);
  registry.register(searchMemoryTool);
  registry.register(recallRelevantTool);
  registry.register(memoryGraphTool);
  registry.register(readArtifactTool);
  registry.register(webResearchTool);
  registry.register(failureReviewTool);
  registry.register(memoryConsolidateTool);
  registry.register(memoryQueryTool);
  registry.register(astGrepTool);
  registry.register(applyDiffTool);
  registry.register(runTestsTool);
  registry.register(runLintTool);
  registry.register(symbolIndexTool);
  registry.register(findReferencesTool);
  registry.register(executeCodeTool);
  registry.register(browserOpenTool);
  registry.register(browserActTool);
  registry.register(suggestImprovementTool);
  registry.register(viewInsightsTool);
  registry.register(visionAnalyzeTool);
  // Obsidian brain
  registry.register(vaultWriteTool);
  registry.register(vaultReadTool);
  registry.register(vaultSearchTool);
  registry.register(vaultListTool);
  registry.register(vaultLinksTool);
  registry.register(vaultGraphTool);
  registry.register(vaultDeleteTool);
  // Session agenda + recurring task scheduler
  registry.register(agendaSetTool);
  registry.register(agendaGetTool);
  registry.register(agendaClearTool);
  registry.register(scheduleCreateTool);
  registry.register(scheduleListTool);
  registry.register(scheduleDeleteTool);
  registry.register(scheduleRunTool);
  // Independence engine
  registry.register(breakoutStartTool);
  registry.register(patternRecordTool);
  registry.register(independenceStatusTool);
  if (process.env["AGENT_DOC_ENGINE"] === "1") {
    registry.register(docPlanTool);
    registry.register(docResearchBriefTool);
    registry.register(docCollectSourcesTool);
    registry.register(docSelectAssetsTool);
    registry.register(docGenerateChartDataTool);
    registry.register(docComposeChunkTool);
    registry.register(docLintLayoutTool);
    registry.register(docRepairChunkTool);
    registry.register(docRenderPptxTool);
    registry.register(docRenderDocxTool);
    registry.register(docRenderPdfTool);
    registry.register(docExportTool);
    registry.register(docQualityReportTool);
  }

  const { listToolFamiliesTool, activateToolFamilyTool } = createToolDiscoveryTools(registry);
  registry.register(listToolFamiliesTool);
  registry.register(activateToolFamilyTool);

  if (harness) {
    // Orchestration tools (spawn_agent, wait_for_agents, cancel_agent, list_agents, verify_result)
    const orch = createOrchestrationTools(harness);
    registry.register(orch.spawnAgentTool);
    registry.register(orch.waitForAgentsTool);
    registry.register(orch.cancelAgentTool);
    registry.register(orch.listAgentsTool);
    registry.register(orch.verifyResultTool);
    registry.register(orch.evidenceCriticTool);
    registry.register(orch.pathCriticTool);
    registry.register(orch.policyCriticTool);
    registry.register(orch.reflectDebateTool);

    // Context budget tools (check_context, compress_context) — close over harness context
    const { checkContextTool, compressContextTool } = createContextTools(harness.getContext());
    registry.register(checkContextTool);
    registry.register(compressContextTool);

    // World context refresh — root-only, excluded from child registries
    registry.register(createRefreshWorldContextTool(harness));

    // Inline persona switching — closes over this specific harness instance
    registry.register(createSetPersonaTool(harness));

    // Harness-scoped multimodal + extraction tools
    registry.register(createUploadImageTool(harness));
    registry.register(createExtractStructuredTool(harness));

    // Upgrade V: goal decomposer, branch explorer, contract verifier
    registry.register(createDecomposeGoalTool(harness));
    registry.register(createBranchExploreTool(harness));
    registry.register(createVerifyContractTool(harness));

    // Upgrade VI: cross-domain synthesis sub-agent
    registry.register(createSynthesisRunTool(harness));
  }

  // Dynamic tool creation — always available
  const { createTool, editTool, removeTool, listDynamicTools: listDynTools } = createDynamicToolsTools(registry, emitter);
  registry.register(createTool);
  registry.register(editTool);
  registry.register(removeTool);
  registry.register(listDynTools);

  // Load any previously-persisted dynamic tools from disk
  await loadDynamicTools(registry, emitter);

  applyLazyRegistrationPolicy(registry, !!harness);
  if (harness) {
    harness.getContext().refreshProtocolDynamic(harness.registry.getActiveToolNames());
  }
}

export { createAskUserTool } from "./ask_user.js";
export {
  INCEPTION_MESSAGES,
  buildInceptionMessages,
  PROTOCOL_CORE,
  buildProtocolDynamicSuffix,
  buildAdaptiveProtocolSuffix,
} from "./systemPrompt.js";
export type { ProtocolIntentHint } from "./systemPrompt.js";
export { buildPersonaBlock, buildRichPersonaBlock } from "./persona_presets.js";
export type { PersonaProfile, SpeechStyle, PersonaTone } from "./persona_presets.js";
export { applyLazyRegistrationPolicy, TOOL_FAMILIES } from "./tool_catalog.js";
export { createOrchestrationTools } from "./orchestration.js";
export { createContextTools } from "./context_tools.js";
export { createSetPersonaTool } from "./set_persona.js";
export {
  parsePersonaInput,
  isResetToDefaultRequest,
  generatePersonaFromInput,
  applyPersonaProfileToHarness,
  clearPersistedPersonaArtifacts,
} from "./persona_runtime.js";
export { loadPlugins } from "./plugin_loader.js";
export type { PluginModule, PluginLoadResult } from "./plugin_loader.js";
