import type { ToolRegistry, AgentEmitter, AgentHarness } from "@liminal/core";
import { effectiveHarnessEnvRaw, resolveHarnessEnvRaw, emailStyleInferEnabled } from "@liminal/core";
import { readFileTool } from "./families/files/read_file.js";
import { writeFileTool } from "./families/files/write_file.js";
import { listDirTool } from "./families/files/list_dir.js";
import { createRunShellTool } from "./families/shell/run_shell.js";
import { webFetchTool } from "./families/web/web_fetch.js";
import { webSearchTool } from "./families/web/web_search.js";
import { weatherLookupTool } from "./families/web/weather_lookup.js";
import { marketsQuoteTool } from "./families/markets/markets_quote.js";
import { createAskUserTool } from "./families/meta/ask_user.js";
import { rememberTool, recallTool, recallByTypeTool, forgetTool, forgetTypeTool, memoryStatsTool } from "./families/memory/remember_recall.js";
import { thinkTool } from "./families/reasoning/think.js";
import { breakdownTool } from "./families/reasoning/breakdown.js";
import { reasonTool } from "./families/reasoning/reason.js";
import { planTool } from "./families/reasoning/plan.js";
import { createHypothesizeTool } from "./families/reasoning/hypothesize.js";
import { searchMemoryTool } from "./families/memory/search_memory.js";
import { recallRelevantTool } from "./families/memory/recall_relevant.js";
import { memoryGraphTool } from "./families/memory/memory_graph.js";
import { readArtifactTool } from "./families/memory/read_artifact.js";
import { failureReviewTool } from "./families/web/failure_review.js";
import { repoMapTool } from "./families/navigation/repo_map.js";
import { memoryConsolidateTool } from "./families/memory/memory_consolidate.js";
import { memoryQueryTool } from "./families/memory/memory_query.js";
import { astGrepTool } from "./families/code_intel/ast_grep.js";
import { runTestsTool } from "./families/code_intel/run_tests.js";
import { runLintTool } from "./families/code_intel/run_lint.js";
import { symbolIndexTool } from "./families/code_intel/symbol_index.js";
import { findReferencesTool } from "./families/code_intel/find_references.js";
import { renameSymbolTool } from "./families/code_intel/rename_symbol.js";
import { executeCodeTool } from "./families/code_intel/execute_code.js";
import { httpRequestTool } from "./families/web/http_request.js";
import {
  runCommandWithPtyTool,
  createRunCommandWithPtyTool,
} from "./families/shell/run_command_with_pty.js";
import { readFileChunkedTool } from "./families/navigation/read_file_chunked.js";
import { readFileWithImportsTool } from "./families/navigation/read_file_with_imports.js";
import { fileMetadataTool } from "./families/files/file_metadata.js";
import { workspaceSnapshotTool } from "./families/navigation/workspace_snapshot.js";
import { grepFileTool } from "./families/files/grep_file.js";
import { editFileTool } from "./families/files/edit_file.js";
import { moveFileTool } from "./families/files/move_file.js";
import { copyFileTool } from "./families/files/copy_file.js";
import { copyTreeTool } from "./families/files/copy_tree.js";
import { mkdirPTool } from "./families/files/mkdir_p.js";
import { deleteFileTool } from "./families/files/delete_file.js";
import { findFilesTool } from "./families/files/find_files.js";
import { multiFileApplyTool } from "./families/files/multi_file_apply.js";
import { pathGuardTool } from "./families/files/path_guard.js";
import {
  browserOpenTool,
  browserNavigateTool,
  browserActTool,
  browserSnapshotTool,
  browserCloseTool,
  browserServeFileTool,
  browserWaitForTool,
  browserExtractTool,
  browserCookiesTool,
  wireBrowserHarnessCleanup,
} from "./families/browser/browser_tools.js";
import { createOpenTerminalTool, wireTerminalHarness } from "./families/shell/terminal_tools.js";
import {
  setTerminalEnsureHandler,
  type EnsureTerminalOptions,
  type EnsureTerminalResult,
} from "./families/shell/terminal_runtime.js";
import { setPtyShellPort, type PtyManagerPort } from "./families/shell/pty_shell_port.js";
import { captchaSolveTool } from "./families/browser/captcha_solve.js";
import { createOrchestrationTools } from "./families/orchestration/orchestration.js";
import { createAgentContextTools } from "./families/orchestration/agent_context_tools.js";
import {
  runBackgroundTool,
  killProcessTool,
  listProcessesTool,
  readProcessOutputTool,
  createRunBackgroundTool,
  createKillProcessTool,
  createListProcessesTool,
  createReadProcessOutputTool,
} from "./families/shell/process_manager.js";
import { suggestImprovementTool, viewInsightsTool } from "./families/meta/meta_tools.js";
import { selfTelemetryTool } from "./families/meta/self_telemetry.js";
import { pasteTrainTool } from "./families/meta/paste_train.js";
import { createContextTools } from "./families/context/context_tools.js";
import { createRecallCompressionTool } from "./families/context/recall_compression.js";
import { createRefreshWorldContextTool } from "./families/orchestration/refresh_world_context.js";
import { createSetPersonaTool } from "./families/harness_ui/set_persona.js";
import { createAppendPersonaLivingTool } from "./families/harness_ui/append_persona_living.js";
import { createSetRuntimeSettingsTool } from "./families/harness_ui/set_runtime_settings.js";
import { createGetRuntimeSettingsTool } from "./families/harness_ui/get_runtime_settings.js";
import { createToolDiscoveryTools } from "./tool_activation.js";
import { applyLazyRegistrationPolicy } from "./tool_catalog.js";
// New tools — Upgrade VI (harness quality)
import { agendaSetTool, agendaGetTool, agendaClearTool } from "./families/agenda_scheduler/session_agenda.js";
import { breakoutStartTool, patternRecordTool, independenceStatusTool } from "./families/independence/independence.js";
import {
  scheduleCreateTool,
  scheduleListTool,
  scheduleDeleteTool,
  scheduleRunTool,
} from "./families/agenda_scheduler/task_scheduler.js";
import { createSynthesisRunTool } from "./families/synthesis/synthesis_run.js";
import { createWorkflowTools } from "./families/workflow/workflow_tools.js";
// New tools — Upgrade V
import { createDecomposeGoalTool } from "./families/orchestration/decompose_goal.js";
import { createEmailStyleInferTool } from "./families/harness_ui/email_style_infer.js";
import { createBranchExploreTool } from "./families/orchestration/branch_explore.js";
import { createVerifyContractTool } from "./families/orchestration/verify_contract.js";
import { createDynamicToolsTools, loadDynamicTools } from "./families/meta/dynamic_tools.js";
import { createApiConnectionTools, restoreOpenApiConnections } from "./integrations/external_api/api_connect.js";
import { createMcpAttachTools, restoreMcpConnections } from "./integrations/external_api/mcp_attach.js";
import { createConnectorTools } from "./integrations/core/connect_provider.js";
import { createGmailSendTools, gmailSendRestEnabled } from "./integrations/google/google_gmail_send.js";
import { createMailSearchInboxesTool } from "./integrations/mail/mail_search_inboxes.js";
import { createGoogleCalendarRestTools, calendarRestEnabled } from "./integrations/google/google_calendar_rest.js";
import { createGoogleAnalyticsRestTools, analyticsRestEnabled } from "./integrations/google/google_analytics_rest.js";
import {
  createGoogleSearchConsoleRestTools,
  searchConsoleRestEnabled,
} from "./integrations/google/google_search_console_rest.js";
import { createGoogleOfficeRestTools, officeRestEnabled } from "./integrations/google/google_office_rest.js";
import { createOutlookSendTools, outlookRestEnabled } from "./integrations/microsoft/outlook_send.js";
import { createMicrosoftCalendarRestTools, microsoftCalendarRestEnabled } from "./integrations/microsoft/microsoft_calendar_rest.js";
import { createOnedriveRestTools, onedriveRestEnabled } from "./integrations/microsoft/onedrive_rest.js";
import { createExcelRestTools, excelRestEnabled } from "./integrations/microsoft/excel_rest.js";
import { createOnenoteRestTools, onenoteRestEnabled } from "./integrations/microsoft/onenote_rest.js";
import { createTeamsRestTools, teamsRestEnabled } from "./integrations/microsoft/teams_rest.js";
import { createPlannerRestTools, plannerRestEnabled } from "./integrations/microsoft/planner_rest.js";
import { createGraphSearchRestTools, graphSearchRestEnabled } from "./integrations/microsoft/graph_search_rest.js";
import { createMicrosoftOfficeRestTools, microsoftOfficeRestEnabled } from "./integrations/microsoft/microsoft_office_rest.js";
import { createAzureArmRestTools } from "./integrations/azure/azure_arm_tools.js";
import { azureRestEnabled } from "./integrations/azure/azure_rest.js";
import { registerXeroRestTools, xeroRestEnabled } from "./integrations/xero/xero_rest.js";
import { registerXeroRestExtendedTools } from "./integrations/xero/xero_rest_extended.js";
import { registerXeroRestPhase2Tools } from "./integrations/xero/xero_rest_phase2.js";
import { registerXeroRestPhase25Tools } from "./integrations/xero/xero_rest_phase25.js";
import { registerXeroRestPhase3Tools } from "./integrations/xero/xero_rest_phase3.js";
import { registerXeroRestPhase35Tools } from "./integrations/xero/xero_rest_phase35.js";
import { registerSlackRestTools, slackRestEnabled } from "./integrations/slack/slack_rest.js";
import { registerLinearRestTools, linearRestEnabled } from "./integrations/linear/linear_rest.js";
import { registerNotionRestTools, notionRestEnabled } from "./integrations/notion/notion_rest.js";
import { createYoutubeRestTools, youtubeRestEnabled } from "./integrations/youtube/youtube_rest.js";
import { agentcardEnabled } from "./integrations/agentcard/agentcard_cli.js";
import { createAgentcardTools } from "./integrations/agentcard/agentcard_tools.js";
import { memoryPromoteTool } from "./families/memory/memory_promote.js";
import { memoryNeighborsTool } from "./families/memory/memory_neighbors.js";
import { consolidateChatTool } from "./families/memory/consolidate_chat.js";
import { curateMemoryTool } from "./families/memory/curate_memory.js";
import { restoreMemoryTool } from "./families/memory/restore_memory.js";
// New tools — Upgrade IV
import { gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool } from "./families/git/git_tools.js";
import { gitCheckpointTool, gitRollbackTool } from "./families/git/git_checkpoint.js";
import { gitWorktreeTool } from "./families/git/git_worktree.js";
import { taskCheckpointTool, resumeTaskTool } from "./families/tasks/task_persistence.js";
import { featureChecklistTool } from "./families/tasks/feature_checklist.js";
import { createExtractStructuredTool } from "./families/harness_ui/extract_structured.js";
import { createUploadImageTool } from "./families/vision/upload_image.js";
import { visionAnalyzeTool } from "./families/vision/vision_analyze.js";
import { createTranscribeAudioTool } from "./families/audio/transcribe_audio.js";
import { createSpeakTool, installVoiceTtsFallback } from "./families/audio/speak.js";
import { docPlanTool } from "./families/document/doc_plan.js";
import { docResearchBriefTool } from "./families/document/doc_research_brief.js";
import { docCollectSourcesTool } from "./families/document/doc_collect_sources.js";
import { docSelectAssetsTool } from "./families/document/doc_select_assets.js";
import { docGenerateChartDataTool } from "./families/document/doc_generate_chart_data.js";
import { docComposeChunkTool } from "./families/document/doc_compose_chunk.js";
import { docLintLayoutTool } from "./families/document/doc_lint_layout.js";
import { docRepairChunkTool } from "./families/document/doc_repair_chunk.js";
import { docRenderPptxTool } from "./families/document/doc_render_pptx.js";
import { docRenderDocxTool } from "./families/document/doc_render_docx.js";
import { docRenderPdfTool } from "./families/document/doc_render_pdf.js";
import { docExportTool } from "./families/document/doc_export.js";
import { docQualityReportTool } from "./families/document/doc_quality_report.js";
// New tools — Upgrade VII (harness power)
import { createQueryToolOutputsTool } from "./families/orchestration/query_tool_outputs.js";
import { createResearchStateTool } from "./families/web/research_state.js";
import { createDispatchGraphTool } from "./families/orchestration/dispatch_graph.js";
import { createBranchEvaluateTool } from "./families/orchestration/branch_evaluate.js";
// Obsidian brain — vault tools
import {
  vaultWriteTool,
  vaultReadTool,
  vaultSearchTool,
  vaultListTool,
  vaultLinksTool,
  vaultGraphTool,
  vaultDeleteTool,
} from "./families/vault/vault_tools.js";
import { vaultIngestTool } from "./families/vault/vault_ingest.js";
import { vaultIngestEntitiesTool } from "./families/vault/vault_ingest_entities.js";
import { vaultRecallTool } from "./families/vault/vault_recall.js";
import { vaultLintTool } from "./families/vault/vault_lint.js";

/**
 * Register all tools onto a registry.
 * Pass `harness` to also register orchestration tools + context tools scoped to that harness.
 */
import type { LiminalAppManagerPort } from "@liminal/core";
import { liminalAppsEnabled } from "@liminal/core";
import { createLiminalAppTools, bootstrapLiminalAppsTools } from "./families/liminal_apps/liminal_apps.js";

export interface RegisterAllToolsDeps {
  appManager?: LiminalAppManagerPort;
  ensureTerminal?: (opts: EnsureTerminalOptions) => Promise<EnsureTerminalResult | null>;
  ptyShellPort?: PtyManagerPort;
}

export async function registerAllTools(
  registry: ToolRegistry,
  emitter: AgentEmitter,
  harness?: AgentHarness,
  deps?: RegisterAllToolsDeps
): Promise<void> {
  registry.register(thinkTool);
  registry.register(breakdownTool);
  registry.register(reasonTool);
  registry.register(planTool);
  registry.register(readFileTool);
  registry.register(readFileChunkedTool);
  registry.register(readFileWithImportsTool);
  registry.register(fileMetadataTool);
  registry.register(workspaceSnapshotTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(grepFileTool);
  registry.register(moveFileTool);
  registry.register(copyFileTool);
  registry.register(copyTreeTool);
  registry.register(mkdirPTool);
  registry.register(deleteFileTool);
  registry.register(findFilesTool);
  registry.register(multiFileApplyTool);
  registry.register(pathGuardTool);
  registry.register(listDirTool);
  registry.register(repoMapTool);
  registry.register(createRunShellTool(emitter, harness));
  if (harness) {
    registry.register(createRunBackgroundTool(harness));
    registry.register(createKillProcessTool(harness));
    registry.register(createListProcessesTool(harness));
    registry.register(createReadProcessOutputTool(harness));
    if (effectiveHarnessEnvRaw("AGENT_PTY_CONTROL_TOOL") === "1") {
      registry.register(createRunCommandWithPtyTool(harness));
    }
  } else {
    registry.register(runBackgroundTool);
    registry.register(killProcessTool);
    registry.register(listProcessesTool);
    registry.register(readProcessOutputTool);
    if (effectiveHarnessEnvRaw("AGENT_PTY_CONTROL_TOOL") === "1") {
      registry.register(runCommandWithPtyTool);
    }
  }
  registry.register(webFetchTool);
  registry.register(webSearchTool);
  registry.register(weatherLookupTool);
  const prefs = harness?.getRuntimePreferences() ?? null;
  if (resolveHarnessEnvRaw("AGENT_MARKETS_ENABLE", prefs) !== "0") {
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
  registry.register(gitWorktreeTool);
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
  // Federation Phase 2 — cross-chat memory tools.
  registry.register(memoryPromoteTool);
  registry.register(memoryNeighborsTool);
  registry.register(consolidateChatTool);
  registry.register(curateMemoryTool);
  registry.register(restoreMemoryTool);
  registry.register(memoryGraphTool);
  registry.register(readArtifactTool);
  registry.register(failureReviewTool);
  registry.register(memoryConsolidateTool);
  registry.register(memoryQueryTool);
  registry.register(astGrepTool);
  registry.register(runTestsTool);
  registry.register(runLintTool);
  registry.register(symbolIndexTool);
  registry.register(findReferencesTool);
  registry.register(renameSymbolTool);
  registry.register(executeCodeTool);
  registry.register(httpRequestTool);
  registry.register(browserOpenTool);
  registry.register(browserNavigateTool);
  registry.register(browserSnapshotTool);
  registry.register(browserActTool);
  registry.register(browserCloseTool);
  registry.register(browserServeFileTool);
  registry.register(browserWaitForTool);
  registry.register(browserExtractTool);
  registry.register(browserCookiesTool);
  registry.register(captchaSolveTool);
  registry.register(suggestImprovementTool);
  registry.register(viewInsightsTool);
  registry.register(selfTelemetryTool);
  registry.register(pasteTrainTool);
  registry.register(visionAnalyzeTool);
  // Obsidian brain
  registry.register(vaultWriteTool);
  registry.register(vaultReadTool);
  registry.register(vaultSearchTool);
  registry.register(vaultListTool);
  registry.register(vaultLinksTool);
  registry.register(vaultGraphTool);
  registry.register(vaultDeleteTool);
  registry.register(vaultIngestTool);
  registry.register(vaultIngestEntitiesTool);
  registry.register(vaultRecallTool);
  registry.register(vaultLintTool);
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
  if (resolveHarnessEnvRaw("AGENT_DOC_ENGINE", prefs) === "1") {
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

    const ctxTools = createAgentContextTools(harness);
    registry.register(ctxTools.shareAgentContextTool);
    registry.register(ctxTools.readAgentContextTool);

    // Context budget tools (check_context, compress_context, recall_compression) — close over harness context
    const { checkContextTool, compressContextTool } = createContextTools(harness.getContext());
    registry.register(checkContextTool);
    registry.register(compressContextTool);
    registry.register(createRecallCompressionTool(harness.getContext()));

    // World context refresh — root-only, excluded from child registries
    registry.register(createRefreshWorldContextTool(harness));

    // Inline persona switching — closes over this specific harness instance
    registry.register(createSetPersonaTool(harness));
    registry.register(createAppendPersonaLivingTool(harness));
    registry.register(createGetRuntimeSettingsTool(harness));
    registry.register(createSetRuntimeSettingsTool(harness));

    // Harness-scoped multimodal + extraction tools
    registry.register(createUploadImageTool(harness));
    registry.register(createHypothesizeTool(harness));
    registry.register(createExtractStructuredTool(harness));
    // Audio transcription — chat-scoped so attachment_id resolves under the
    // active chat's per-chat audio dir.
    if (resolveHarnessEnvRaw("AGENT_TRANSCRIBE_ENABLED", prefs) !== "0") {
      registry.register(createTranscribeAudioTool(harness));
    }
    if (resolveHarnessEnvRaw("AGENT_TTS_ENABLED", prefs) === "1") {
      registry.register(createSpeakTool(harness));
      installVoiceTtsFallback(harness);
    }

    if (emailStyleInferEnabled()) {
      registry.register(createEmailStyleInferTool(harness));
    }

    // Upgrade V: goal decomposer, branch explorer, contract verifier
    registry.register(createDecomposeGoalTool(harness));
    registry.register(createBranchExploreTool(harness));
    registry.register(createVerifyContractTool(harness));

    // Upgrade VI: cross-domain synthesis sub-agent
    registry.register(createSynthesisRunTool(harness));

    // Dynamic workflows (ultracode-equivalent) — root-only; fan out sub-agents
    // per phase with results stored out of context. Excluded from child
    // registries via ORCHESTRATION_TOOL_NAMES (children don't nest workflows).
    if (resolveHarnessEnvRaw("AGENT_WORKFLOWS", prefs) !== "0") {
      const wf = createWorkflowTools(harness);
      registry.register(wf.planWorkflowTool);
      registry.register(wf.runWorkflowTool);
      registry.register(wf.workflowStatusTool);
      registry.register(wf.queryWorkflowTool);
    }

    // Upgrade VII: session tool index query, intra-round DAG scheduling, branch evaluation
    registry.register(createQueryToolOutputsTool(harness));
    registry.register(createResearchStateTool(harness.getResearchLedger()));
    registry.register(createDispatchGraphTool(harness));
    registry.register(createBranchEvaluateTool(harness));

    wireBrowserHarnessCleanup(harness);
    wireTerminalHarness(harness);
    registry.register(createOpenTerminalTool(harness));
  }

  if (deps?.ensureTerminal) {
    setTerminalEnsureHandler(deps.ensureTerminal);
  }
  if (deps?.ptyShellPort) {
    setPtyShellPort(deps.ptyShellPort);
  }

  // Dynamic tool creation — always available
  const { createTool, editTool, removeTool, listDynamicTools: listDynTools } = createDynamicToolsTools(registry, emitter);
  registry.register(createTool);
  registry.register(editTool);
  registry.register(removeTool);
  registry.register(listDynTools);

  // Load any previously-persisted dynamic tools from disk
  await loadDynamicTools(registry, emitter);

  // External API + MCP connections — meta tools are always available; the
  // operation tools they generate are spec/server-defined and survive restarts.
  const { apiConnectTool, apiDisconnectTool, apiListTool } = createApiConnectionTools(registry, emitter);
  registry.register(apiConnectTool);
  registry.register(apiDisconnectTool);
  registry.register(apiListTool);
  const { mcpAttachTool, mcpDetachTool } = createMcpAttachTools(registry, emitter);
  registry.register(mcpAttachTool);
  registry.register(mcpDetachTool);
  const connectorTools = createConnectorTools(registry, emitter);
  registry.register(connectorTools.connectProviderTool);
  registry.register(connectorTools.disconnectProviderTool);
  registry.register(connectorTools.listConnectorsTool);
  if (gmailSendRestEnabled()) {
    for (const t of createGmailSendTools()) registry.register(t);
    registry.register(createMailSearchInboxesTool());
  }
  if (calendarRestEnabled()) {
    for (const t of createGoogleCalendarRestTools()) registry.register(t);
  }
  if (analyticsRestEnabled()) {
    for (const t of createGoogleAnalyticsRestTools()) registry.register(t);
  }
  if (searchConsoleRestEnabled()) {
    for (const t of createGoogleSearchConsoleRestTools()) registry.register(t);
  }
  if (youtubeRestEnabled()) {
    for (const t of createYoutubeRestTools()) registry.register(t);
  }
  if (officeRestEnabled()) {
    for (const t of createGoogleOfficeRestTools()) registry.register(t);
  }
  if (outlookRestEnabled()) {
    for (const t of createOutlookSendTools()) registry.register(t);
  }
  if (microsoftCalendarRestEnabled()) {
    for (const t of createMicrosoftCalendarRestTools()) registry.register(t);
  }
  if (onedriveRestEnabled()) {
    for (const t of createOnedriveRestTools()) registry.register(t);
  }
  if (excelRestEnabled()) {
    for (const t of createExcelRestTools()) registry.register(t);
  }
  if (onenoteRestEnabled()) {
    for (const t of createOnenoteRestTools()) registry.register(t);
  }
  if (teamsRestEnabled()) {
    for (const t of createTeamsRestTools()) registry.register(t);
  }
  if (plannerRestEnabled()) {
    for (const t of createPlannerRestTools()) registry.register(t);
  }
  if (graphSearchRestEnabled()) {
    for (const t of createGraphSearchRestTools()) registry.register(t);
  }
  if (azureRestEnabled()) {
    for (const t of createAzureArmRestTools()) registry.register(t);
  }
  if (microsoftOfficeRestEnabled()) {
    for (const t of createMicrosoftOfficeRestTools()) registry.register(t);
  }
  if (xeroRestEnabled()) {
    registerXeroRestTools(registry);
    registerXeroRestExtendedTools(registry);
    registerXeroRestPhase2Tools(registry);
    registerXeroRestPhase25Tools(registry);
    registerXeroRestPhase3Tools(registry);
    registerXeroRestPhase35Tools(registry);
  }
  if (slackRestEnabled()) {
    registerSlackRestTools(registry);
  }
  if (linearRestEnabled()) {
    registerLinearRestTools(registry);
  }
  if (notionRestEnabled()) {
    registerNotionRestTools(registry);
  }
  if (agentcardEnabled()) {
    for (const t of createAgentcardTools()) registry.register(t);
  }
  // Re-register previously-attached connections so their generated tools are
  // live on the next ReAct turn. Best-effort — failures are logged via emitter.
  applyLazyRegistrationPolicy(registry, harness);

  // Restore persisted MCP/OpenAPI connections (under lazy loading, tools stay inactive until activate_tool_family).
  await restoreOpenApiConnections(registry, emitter);
  await restoreMcpConnections(registry, emitter);
  // Sidecar spawn + live MCP attach can take minutes (npx download). Do not block harness init.
  const { deferIntegrationBootstrap } = await import("./integrations/core/integration_boot.js");
  deferIntegrationBootstrap(registry, emitter, harness);
  if (deps?.appManager && liminalAppsEnabled()) {
    const appTools = createLiminalAppTools(registry, deps.appManager, harness);
    registry.register(appTools.listAppTypesTool);
    registry.register(appTools.listAppsTool);
    registry.register(appTools.previewAppHtmlTool);
    registry.register(appTools.readAppHtmlTool);
    registry.register(appTools.grepAppHtmlTool);
    registry.register(appTools.spawnAppTool);
    registry.register(appTools.updateAppTool);
    registry.register(appTools.closeAppTool);
    bootstrapLiminalAppsTools(registry);
  }

  if (harness) {
    harness.getContext().refreshProtocolDynamic(harness.registry.getActiveToolNames());
  }
}

export { createInboxProviderPolls } from "./integrations/inbox/inbox_poll_registry.js";

export { fetchWeather } from "./families/web/weather_fetch.js";
export type { WeatherFetchInput, WeatherFetchResult } from "./families/web/weather_fetch.js";

export { createAskUserTool } from "./families/meta/ask_user.js";
export {
  INCEPTION_MESSAGES,
  buildInceptionMessages,
  PROTOCOL_CORE,
  buildProtocolDynamicSuffix,
  buildAdaptiveProtocolSuffix,
} from "./shared/systemPrompt.js";
export type { ProtocolIntentHint } from "./shared/systemPrompt.js";
export {
  buildHarnessCapabilityDomains,
  buildHarnessProductFacts,
  buildHarnessToolManifest,
  buildLiminalRuntimeIdentityBlock,
  countCatalogFamilies,
  countCatalogToolNames,
} from "./shared/harness_runtime_prompt.js";
export { buildPersonaBlock, buildRichPersonaBlock } from "./families/harness_ui/persona_presets.js";
export type { PersonaProfile, SpeechStyle, PersonaTone } from "./families/harness_ui/persona_presets.js";
export { applyLazyRegistrationPolicy, TOOL_FAMILIES } from "./tool_catalog.js";
export { createOrchestrationTools } from "./families/orchestration/orchestration.js";
export { createContextTools } from "./families/context/context_tools.js";
export { createRecallCompressionTool } from "./families/context/recall_compression.js";
export { createSetPersonaTool } from "./families/harness_ui/set_persona.js";
export { createAppendPersonaLivingTool } from "./families/harness_ui/append_persona_living.js";
export { createGetRuntimeSettingsTool } from "./families/harness_ui/get_runtime_settings.js";
export { createSetRuntimeSettingsTool } from "./families/harness_ui/set_runtime_settings.js";
export {
  parsePersonaInput,
  isResetToDefaultRequest,
  generatePersonaFromInput,
  applyPersonaProfileToHarness,
  clearPersistedPersonaArtifacts,
  installDefaultPersonaArtifacts,
  resetPersonaBootstrapState,
  loadPersonaUiThemeFromWorkspace,
  loadPersonaUiCopyFromWorkspace,
  loadPersonaProfileFromWorkspace,
  appendPersonaLivingSection,
  buildPersonaSoulMarkdownFromSlices,
  getPersonaArtifactsPaths,
  PERSONA_LIVING_MAX_APPEND_CHARS,
  PERSONA_LIVING_MAX_FILE_CHARS,
} from "./families/harness_ui/persona_runtime.js";
export {
  LIMINAL_DEFAULT_PROFILE,
  LIMINAL_DEFAULT_UI_THEME,
  LIMINAL_DEFAULT_UI_COPY,
  LIMINAL_DEFAULT_CONTROLS,
  LIMINAL_DEFAULT_SOUL,
} from "./families/harness_ui/persona_default.js";
export { loadPlugins } from "./families/meta/plugin_loader.js";
export type { PluginModule, PluginLoadResult } from "./families/meta/plugin_loader.js";
// Audio attachment helpers — re-exported for the web layer so it can persist
// uploads and pass attachment_id into the transcribe_audio tool.
export {
  saveAudioAttachment,
  findAudioAttachment,
  readAudioAttachment,
  SUPPORTED_AUDIO_MIME_TYPES,
  normalizeAudioMimeType,
} from "./families/audio/audio_attachments.js";
export type { AudioAttachmentInput, AudioAttachmentRecord } from "./families/audio/audio_attachments.js";
export { saveTtsClip, readTtsClip, ttsClipAudioUrl } from "./families/audio/tts_clips.js";
export {
  handleAudioUpload,
  handleTranscribe,
  handleTtsPost,
  readTtsClipBytes,
  sanitizeAudioFilename,
  type AudioBridgeContext,
  type AudioHandlerResult,
} from "./families/audio/audio_http_handlers.js";
export type { SavedTtsClip } from "./families/audio/tts_clips.js";
export { defineTool } from "./shared/helpers.js";
export {
  getBrowserPanelFrame,
  getBrowserSession,
  getSessionCookies,
  refreshBrowserEmbedView,
  setBrowserViewPublisher,
  setBrowserViewPublisherForTask,
  userNavigateBrowserSession,
} from "./families/browser/browser_runtime.js";
export {
  startBrowserScreencast,
  stopBrowserScreencastForSession,
  subscribeBrowserScreencast,
  unsubscribeBrowserScreencast,
  handleBrowserStreamInput,
  getBrowserScreencastMeta,
  parseBrowserStreamInput,
  type BrowserStreamInput,
  type BrowserStreamSocket,
} from "./families/browser/browser_screencast.js";
export {
  setTerminalViewPublisher,
  setTerminalEnsureHandler,
  type EnsureTerminalOptions,
  type EnsureTerminalResult,
  type TerminalViewPayload,
} from "./families/shell/terminal_runtime.js";
export {
  setPtyShellPort,
  getPtyShellPort,
  type PtyManagerPort,
} from "./families/shell/pty_shell_port.js";
export { shellUseUiPty } from "./families/shell/terminal_shell_runtime.js";
export {
  connectGoogleWorkspaceFromServer,
  disconnectGoogleWorkspaceFromServer,
  connectMicrosoft365FromServer,
  disconnectMicrosoft365FromServer,
  connectAzureFromServer,
  disconnectAzureFromServer,
  connectGithubFromServer,
  disconnectGithubFromServer,
  connectXeroFromServer,
  disconnectXeroFromServer,
  connectSlackFromServer,
  disconnectSlackFromServer,
  connectLinearFromServer,
  disconnectLinearFromServer,
  connectNotionFromServer,
  disconnectNotionFromServer,
  connectYoutubeFromServer,
  disconnectYoutubeFromServer,
} from "./integrations/core/connect_provider.js";
export {
  revokeIntegrationAccountFromServer,
  type IntegrationAccountSlug,
} from "./integrations/core/revoke_integration_account.js";
export { getMicrosoftSidecarStatus, stopMicrosoftSidecar } from "./integrations/microsoft/microsoft_sidecar.js";
export { getAzureSidecarStatus, stopAzureSidecar } from "./integrations/azure/azure_sidecar.js";
export {
  githubMcpEnabled,
  githubTokenPresent,
  githubAuthAvailable,
  githubConnectOnBoot,
  connectGithubMcp,
  disconnectGithubMcp,
} from "./integrations/github/github_connect.js";
export { getGoogleSidecarStatus, stopGoogleSidecar } from "./integrations/google/google_sidecar.js";
export {
  listIntegrationConnections,
  attachCustomMcpFromServer,
  detachCustomMcpFromServer,
  connectOpenApiFromServer,
  disconnectOpenApiFromServer,
  parseAuthBody,
  refreshIntegrationToolsOnRegistry,
} from "./integrations/core/integrations_server.js";
export type { IntegrationConnectionSummary } from "./integrations/core/integrations_server.js";
export {
  buildIntegrationsSnapshot,
  deriveIntegrationProviderStatuses,
} from "./integrations/core/integrations_snapshot.js";
export type {
  IntegrationsSnapshot,
  IntegrationProviderStatus,
  IntegrationConnectMode,
} from "./integrations/core/integrations_snapshot.js";
export {
  INTEGRATION_PROVIDER_CATALOG,
  INTEGRATION_PROVIDER_BY_ID,
} from "./integrations/core/integration_providers.js";
export type { IntegrationProviderId, IntegrationProviderCatalogEntry } from "./integrations/core/integration_providers.js";
