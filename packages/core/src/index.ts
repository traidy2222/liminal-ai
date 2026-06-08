export { resolveWorkspaceRoot, runWithWorkspaceRoot } from "./workspace_root.js";
export { resolveCurrentChatId, runWithChatId } from "./chat_context.js";
export { resolveOrgContext, runWithOrgContext } from "./org_context.js";
export type { OrgContext } from "./org_context.js";
export {
  getNotesFacade,
  setNotesFacade,
  setNotesFacadeFactory,
  getNoteValue,
  defaultScopeForKey,
  LocalNotesFacade,
} from "./notes_facade.js";
export type {
  CloudSyncNotesPutBody,
  CloudSyncNotesGetResponse,
  TeamMemoryNotesPutBody,
  TeamMemoryNotesGetResponse,
} from "./cloud_sync_types.js";
export type { NotesFacade, StoredNote, RawNotesStore, NoteScope } from "./notes_facade.js";
export { resolveOrgContextForHarness } from "./vireon_account.js";
export {
  resolveGlobalStorageRoot,
  ensureGlobalStorageRoot,
  ensureGlobalStorageRootSync,
  globalPath,
  globalChatsRoot,
  perChatPath,
  ensurePerChatDir,
  ensurePerChatDirSync,
  sanitizeChatId,
  notesPaths,
  notesArchivePaths,
  failureLogPaths,
  recipeStatsPaths,
  runtimePrefsPaths,
  personaActivePaths,
  memoryIndexPaths,
  vaultIndexPaths,
  pickReadPath,
  pickWritePath,
  workspaceFingerprint,
} from "./global_storage.js";
export type { TieredPaths } from "./global_storage.js";
export { hasPersistedPersonaProfile } from "./persona_artifacts.js";
export {
  LIMINAL_APP_TYPES,
  LIMINAL_APP_SPEC_V,
  buildAppSpecFromSpawn,
  liminalAppsEnabled,
  liminalAppsDesktopRuntime,
  sanitizeAppId,
  validateAppProps,
  validateWeatherAppProps,
  getAppTypeMeta,
  listApps,
  getApp,
  upsertApp,
  removeApp,
  readAppCache,
  writeAppCache,
  readAllAppCaches,
  readAppManifest,
  readAppHtml,
  writeAppHtml,
  resolveStoredAppHtml,
  isHtmlCapableType,
  normalizeHtmlPropsForPersist,
  resolveAppBodyHtml,
  repairWidgetHtmlDocument,
  applyHtmlEdit,
  grepAppHtmlLines,
  readAppHtmlSlice,
  isProxyUrlAllowed,
  normalizeProxyHosts,
  extractHostsFromDataFetch,
  defaultShellForType,
  normalizeAppShell,
} from "./liminal_apps/index.js";
export type {
  LiminalAppType,
  LiminalAppSpec,
  LiminalAppSource,
  AppCacheEntry,
  SpawnAppInput,
  WeatherAppProps,
  LiminalAppTypeMeta,
  LiminalAppManagerPort,
  UpdateAppPatch,
  LiminalAppShell,
  LiminalAppShellMode,
} from "./liminal_apps/index.js";
export {
  TRANSCRIPTION_MODEL_RATES,
  DEFAULT_TRANSCRIBE_MODEL,
  estimateTranscriptionCostUsd,
  resolveTranscriptionConfig,
  resolveTranscriptionConfigAsync,
  transcribeAudio,
  usesOpenRouterSttJson,
} from "./transcription.js";
export type {
  TranscriptionConfig,
  TranscriptionInput,
  TranscriptionResult,
  TranscriptionSegment,
  TranscriptionModelRate,
} from "./transcription.js";
export {
  TTS_MODEL_RATES,
  DEFAULT_TTS_MODEL,
  AFFORDABLE_TTS_MODEL,
  normalizeTtsModelSlug,
  DEFAULT_TTS_VOICE,
  TTS_MODEL_INPUT_MAX_CHARS,
  TTS_MODEL_OUTPUT_MAX_TOKENS,
  DEFAULT_TTS_CHUNK_CHARS,
  ttsMaxOutputTokensForInput,
  splitTextForTtsChunks,
  synthesizeSpeechMulti,
  estimateTtsCostUsd,
  resolveSpeechSynthesisConfig,
  resolveSpeechSynthesisConfigAsync,
  sanitizeTextForTts,
  synthesizeSpeech,
  coerceTtsConfigForBrowserPlayback,
  wrapPcm16LeMonoAsWav,
  normalizeTtsBytesForBrowserPlayback,
  TTS_PCM_SAMPLE_RATE,
} from "./speech_synthesis.js";
export type {
  SpeechSynthesisConfig,
  SynthesizeSpeechInput,
  SynthesizeSpeechResult,
  TtsModelRate,
} from "./speech_synthesis.js";
export { TtsTurnBudget } from "./tts_budget.js";
export type { TtsBudgetConsumeResult } from "./tts_budget.js";
export {
  LIVE_DICTATION_TURN_INJECTION,
  LIVE_DICTATION_SPEAK_NUDGE,
} from "./live_dictation.js";
export {
  readChatMetadata,
  writeChatMetadata,
  touchChatMetadata,
  createChatMetadata,
  listChats,
  listOrphanChatIds,
  adoptOrphanChatMetadata,
  adoptAllOrphanChats,
  scratchWorkspaceRoot,
} from "./chat_metadata.js";
export type { ChatMetadata, ChatKind, ChatWorkspaceMode } from "./chat_metadata.js";
export { readLastActiveChatId, saveLastActiveChatId } from "./active_chat_state.js";
export type { ActiveChatState } from "./active_chat_state.js";
export { resolveChatBoot } from "./chat_boot.js";
export type { ChatBootMode, ChatBootOptions, ChatBootResult } from "./chat_boot.js";
export {
  loadChatTranscriptFromSessionLog,
  slimReplayEntriesForWire,
  parseSessionJsonlForReplay,
  conversationEntriesForHydration,
} from "./chat_session_replay.js";
export type { ReplayTranscriptEntry, ReplayEntryKind } from "./chat_session_replay.js";
export {
  runHarnessEffectiveEnvContext,
  resolveHarnessEnvRaw,
  effectiveHarnessEnvRaw,
  effectiveHarnessEnvString,
  harnessEnvResolutionMeta,
} from "./harness_effective_env.js";
export type { HarnessEnvResolutionSource } from "./harness_effective_env.js";
export {
  DEFAULT_AGENT_API_BASE_URL,
  DEFAULT_AGENT_MODEL_SLUG,
  DEFAULT_AGENT_FAST_MODEL_SLUG,
  HARNESS_ENV_DEFAULTS,
} from "./harness_default_constants.js";
export {
  OPENROUTER_MODEL_SLUG,
  PROVIDER_MODEL_PRESETS,
  buildHarnessModelPackEnvPatch,
  findProviderModelPreset,
  resolveProviderModelPresetId,
} from "./provider_model_presets.js";
export type { ProviderModelPreset } from "./provider_model_presets.js";
export {
  HARNESS_SECRET_ENV_KEYS,
  HARNESS_MANAGED_ENV_KEYS,
  HARNESS_MANAGED_ENV_KEY_SET,
} from "./harness_env_inventory.js";
export { HARNESS_SETTINGS_UI_SECTIONS } from "./harness_settings_sections.js";
export {
  HARNESS_SETTINGS_TABS,
  HARNESS_SETTINGS_FIELD_META,
  HARNESS_SETTINGS_SUBGROUP_LABELS,
  harnessSettingsSubgroupLabel,
} from "./harness_settings_field_meta.js";
export type {
  HarnessSettingsTabId,
  HarnessSettingsFieldMeta,
  HarnessSettingsValueKind,
  ManagedHarnessEnvKey,
} from "./harness_settings_field_meta.js";
export { buildHarnessSettingsApiFields } from "./harness_settings_api.js";
export type { HarnessSettingsApiField } from "./harness_settings_api.js";
export { AgentHarness } from "./agent.js";
export { AgentEmitter } from "./events.js";
export { ContextManager } from "./context.js";
export { ToolRegistry } from "./registry.js";
export { ToolDispatcher } from "./dispatcher.js";
export { StreamAccumulator } from "./streaming.js";
export { TaskOrchestrator } from "./orchestrator.js";
export type { TaskRecord, LockMode } from "./orchestrator.js";
export { buildWorldContextMessage } from "./world_context.js";
export { detectEmailPlaceholderViolations } from "./harness_product_identity.js";
export { gatherRepoMapLines } from "./repo_map.js";
export type { RepoMapOptions } from "./repo_map.js";
export { guardToolArgs } from "./tool_arg_guard.js";
export {
  FILE_WRITE_TOOL_NAMES,
  SPAWN_APP_TOOL_NAME,
  isFileWriteToolName,
  isSpawnAppToolName,
  isLikelyTruncatedFileContent,
  batchHasUndispatchableFileWrites,
  batchHasUndispatchableSpawnApps,
  spawnAppToolNeedsLengthResume,
  canEagerDispatchTool,
  shouldDispatchToolBatch,
  shouldEagerDispatchWhenArgsComplete,
  LENGTH_RESUME_SPAWN_APP_MESSAGE,
} from "./file_write_resume.js";
export {
  setFileWriteStreamManifest,
  takeFileWriteStreamManifest,
  discardFileWriteStreamManifest,
} from "./file_write_stream_manifest.js";
export type { FileWriteStreamManifest } from "./file_write_stream_manifest.js";
export {
  FileWriteStreamSink,
  resolveWriteStreamSinkEnabled,
  resolveWriteStreamSinkMinChars,
} from "./file_write_stream_sink.js";
export {
  SpawnAppHtmlStreamSink,
  resolveSpawnAppHtmlStreamSinkEnabled,
} from "./spawn_app_html_stream_sink.js";
export {
  tryExtractJsonStringField,
  decodePartialJsonStringField,
  createContentStreamParseState,
  ingestToolArgJsonDelta,
  getDecodedContentFromRaw,
} from "./tool_arg_content_stream.js";
export type { ContentStreamParseState, PartialJsonStringField } from "./tool_arg_content_stream.js";
export {
  STREAMING_WRITE_TOOL_SPECS,
  extractStreamingWritePreview,
  isStreamingWriteTool,
} from "./streaming_write_preview.js";
export type { StreamingWritePreview, StreamingWriteToolSpec } from "./streaming_write_preview.js";
export {
  tokenize,
  rankDocumentsForQuery,
  memoryTypeBoost,
  recencyBoost,
  trustBoost,
  spacedRepetitionDecay,
  scoreTurnAgainstIndex,
  detectContradictions,
  parseRecalledNoteBlocks,
} from "./memory_rank.js";
export type { RankableDoc, Contradiction } from "./memory_rank.js";
export { cosineSimilarity, fetchEmbeddings } from "./embeddings.js";
export type { EmbedBatchResult } from "./embeddings.js";
export { SafetyJudge } from "./safety_judge.js";
export type {
  SafetyJudgeConfig,
  SafetyClassification,
  SafetyJudgeSource,
  SafetyJudgeVerdict,
} from "./safety_judge.js";
export {
  normalizeAgentVaultRawPath,
  getExplicitAgentVaultPathFromEnv,
  getAgentVaultRoot,
} from "./vault_path.js";
export type {
  Message,
  ToolDefinition,
  ToolResult,
  ToolHandler,
  ToolParameterSchema,
  PropertySchema,
  ApprovalDecision,
  AccumulatedToolCall,
  StreamChunk,
  ContextConfig,
  ContextSnapshot,
  AgentEventMap,
  AgentEventName,
  AgentConfig,
  ChildAgentConfig,
  SubagentSpawnContract,
  SubtaskResult,
  WorldContextOptions,
  PersonaConfig,
  TurnEndHarnessMetrics,
  TurnEndTerminationReason,
  TurnSummary,
  EpistemicState,
  AgentSafetyJudgeOptions,
  ExecutionState,
  ExecutionContract,
  MissionPlan,
  MilestonePlan,
  CommitmentRule,
  RecoveryRecord,
  DocumentIR,
  DocChunk,
  DocStyleGenome,
  DocQualityReport,
  SlideLayout,
  BulletEmphasis,
  BulletItem,
} from "./types.js";
export { STREAM_WIRE_VERSION } from "./types.js";
export { getFastModelSlug, completeChatJson, clearJsonResponseCache } from "./router.js";
export { inferEmailStyle, emailStyleInferEnabled } from "./email_style_infer.js";
export type {
  EmailStyleInferInput,
  EmailStyleInferResult,
  EmailStyleTier,
} from "./email_style_infer.js";
export { buildAutoDreamPrompt } from "./auto_dream.js";
export {
  resolveEffortLevel,
  parseEffortLevel,
  buildEffortDirective,
  buildEffortTurnInjection,
  scaleMaxCompletionTokensForEffort,
  formatOutputEffortTraceLine,
  DEFAULT_EFFORT_LEVEL,
} from "./output_effort.js";
export type { EffortLevel } from "./output_effort.js";
export {
  parseWorkflowSpec,
  topoSortPhases,
  buildPlanWorkflowPrompt,
  detectWorkflowSignal,
  defaultFamiliesForKind,
  inferWorkflowTaskFamilies,
  workflowNeedsWebTools,
  WORKFLOW_WEB_ACTIVATE_TOOLS,
  WORKFLOW_KNOWN_FAMILIES,
  WORKFLOW_MAX_PHASES,
  WORKFLOW_MAX_TASKS_PER_PHASE,
  WORKFLOW_MAX_TOTAL_TASKS,
} from "./workflow_spec.js";
export type {
  WorkflowSpec,
  WorkflowPhaseSpec,
  WorkflowTaskSpec,
  WorkflowVerifySpec,
  WorkflowPhaseKind,
  WorkflowVerifyGate,
  WorkflowSignal,
  ParseWorkflowResult,
} from "./workflow_spec.js";
export { WorkflowStore, workflowRunDir } from "./workflow_store.js";
export type { WorkflowAgentResult, WorkflowQueryHit } from "./workflow_store.js";
export { WorkflowRuntime } from "./workflow_runtime.js";
export type {
  WorkflowReport,
  PhaseSummary,
  WorkflowSpawn,
  WorkflowRuntimeDeps,
  WorkflowSummarizeInput,
  WorkflowVerifyInput,
} from "./workflow_runtime.js";
export {
  buildCuratorPrompt,
  parseCuratorPlan,
  applyCuratorSafetyRails,
  selectReviewSlice,
  resolveCuratorSafetyOpts,
  protectionRuleFor,
} from "./memory_curator.js";
export type {
  CuratorNote,
  CuratorPlan,
  CuratorPrune,
  CuratorMerge,
  CuratorAdjust,
  CuratorSafetyOpts,
  VetoedItem,
} from "./memory_curator.js";
export type { JsonCompletionResult } from "./router.js";
export {
  resolvePersonalityHeartbeatConfig,
  parseHeartbeatTickJson,
  decideUserNudgeSurface,
  appendPersonalityHeartbeatLog,
  personalityHeartbeatLogPath,
  executePersonalityHeartbeat,
} from "./personality_heartbeat.js";
export type {
  PersonalityHeartbeatConfig,
  HeartbeatTickParsed,
  HeartbeatSurfaceDecision,
  HeartbeatLogRecord,
  ExecutePersonalityHeartbeatResult,
} from "./personality_heartbeat.js";
export {
  withProviderRequestSpacing,
  providerSpacingKey,
  resolveProviderMinIntervalMs,
} from "./provider_request_gate.js";
export type { ProviderCredentials } from "./provider_request_gate.js";
export { rewriteQueryForRecall, rewriteQueryForIdentityRecall } from "./query_rewrite.js";
export {
  IDENTITY_MEMORY_KEYS,
  loadIdentityNotesFromDisk,
  formatIdentityRecallBlock,
  extractPreferredNameFromMessage,
} from "./user_identity_memory.js";
export type { IdentityNameExtraction } from "./user_identity_memory.js";
export type { RewriteQueryResult } from "./query_rewrite.js";
export {
  isPlanStepDone,
  planStepLabel,
  markPlanStepDone,
  countPlanStepsDone,
} from "./plan_transcript.js";
export {
  emptyEpistemicState,
  mergeEpistemicState,
  renderEpistemicStateBlock,
  markEpistemicPlanStepDone,
  mergeExtractedSubgoals,
  subgoalsFromPlanSteps,
  appendEpistemicHypothesis,
} from "./epistemic_state.js";
export type { EpistemicHypothesisRow } from "./epistemic_state.js";
export {
  createDefaultExecutionState,
  advanceExecutionStateForPlan,
  markExecutionContractStatus,
  appendRecoveryRecord,
  updateDriftScore,
  renderExecutionStateBlock,
  getCompensationLedger,
  recordCompensation,
} from "./execution_state.js";
export {
  CompensationLedger,
  inferCompensationAction,
  formatCompensationReport,
} from "./compensation_ledger.js";
export type { CompensationAction, LedgerEntry, CompensationResult } from "./compensation_ledger.js";
export {
  distillToolOutput,
  shouldDistillToolOutput,
  writeArtifact,
  readArtifactText,
  artifactPathForHash,
  stashToolBodyElide,
} from "./output_distill.js";
export type { DistilledOutput } from "./output_distill.js";
export { appendFailureLog, failureLogPath } from "./failure_log.js";
export { formatFailureDigestForWorldContext } from "./failure_digest.js";
export { recordRecipe, formatRecipeLibraryHints, formatTopRecipes, phaseShapeForTools } from "./recipe_library.js";
export type { RecipeEntry, RecipePhase, RecordRecipeInput } from "./recipe_library.js";
export {
  attachSessionEventLog,
  maybeAttachSessionEventLog,
  writeYieldSnapshot,
  readYieldSnapshot,
  resolveSessionTextLogMode,
  sessionTraceLogEnabled,
} from "./session_event_log.js";
export {
  consolidateChatSession,
  loadSessionSnippet,
  resolveConsolidateOnIdleConfig,
} from "./consolidate_session.js";
export type { ConsolidateSessionResult, ConsolidateUpsert } from "./consolidate_session.js";
export {
  evaluateMissionContinue,
  buildResumeMissionBlock,
  loadLatestInProgressTask,
  resolveMissionAutonomyConfig,
} from "./mission_controller.js";
export type { InProgressTask, MissionContinueDecision } from "./mission_controller.js";
export { rankNotesForPriming } from "./memory_priming.js";
export type { MemoryPrimingOptions } from "./memory_priming.js";
export { inferIntentToolFamilies } from "./intent_tool_families.js";
export { buildHarnessRuleRecallMessageForIntent } from "./harness_rules.js";
export {
  readWorkflowCursor,
  writeWorkflowCursor,
} from "./workflow_store.js";
export type { WorkflowRunCursor } from "./workflow_store.js";
export type { YieldSnapshot } from "./session_event_log.js";
export { appendGoldenEvalRecord } from "./golden_eval.js";
export {
  DEFAULT_OPENROUTER_HTTP_REFERER,
  DEFAULT_OPENROUTER_X_TITLE,
  buildOpenRouterAttributionHeaders,
} from "./openrouter_attribution.js";
export type { OpenRouterAttributionHeaders } from "./openrouter_attribution.js";
export {
  buildOpenRouterSessionExtras,
  isOpenRouterApiBaseUrl,
  supportsOpenRouterRequestExtras,
  normalizeOpenRouterSessionId,
  openRouterSessionsEnabled,
  resolveOpenRouterSessionId,
} from "./openrouter_session.js";
export type { OpenRouterSessionRequestExtras } from "./openrouter_session.js";
export { resolveProviderConfig, resolveVisionProviderConfig, resolveVisionProviderConfigAsync, buildProviderRouting, resolveProviderRouting, buildOpenRouterChatRequestExtras, resolveProviderStrategy, sessionEpochBumpOn429Enabled, isOpenRouterStealthModel, OPENROUTER_STEALTH_MODEL_SLUGS } from "./provider_config.js";
export type { ProviderConfig, ProviderConfigOverrides, VisionProviderConfig, ProviderRouting, ProviderRoutingContext, ProviderStrategy, ProviderSortAxis, OpenRouterChatRequestExtras } from "./provider_config.js";
export { ProviderRouteState } from "./provider_route_state.js";
export type { ProviderRouteSnapshot } from "./provider_route_state.js";
export { parseOpenRouterProviderSlug } from "./openrouter_errors.js";
export {
  parseVireonUpstreamRetryCount,
  vireonProxyAlreadyRetriedUpstream,
  managedUpstreamBusyMessage,
} from "./vireon_proxy.js";
export {
  resolveInferenceMode,
  resolveProviderConfigWithInference,
  resolveManagedOpenRouterCredentials,
  shouldRouteOpenRouterViaManaged,
  managedInferenceBaseUrl,
  fetchInferenceSession,
  fetchInferenceUsageStatus,
  hasLocalProviderApiKey,
  inferencePreferManaged,
  describeProviderError,
  formatInferenceBudgetExceededMessage,
  inferenceAccountUrl,
  isInferenceBudgetExceededError,
  isManagedInferenceAuthError,
  proManagedInferencePrefsPatch,
} from "./inference_provider.js";
export {
  ensureLocalProviderApiKeyInProcess,
  resolveLocalProviderApiKey,
  providerApiKeyEnvFileCandidates,
} from "./provider_api_key.js";
export {
  buildManagedFreeFallbackHarnessEnv,
  managedFreeFallbackEnabled,
  resolveManagedFreeFallbackFastModel,
  resolveManagedFreeFallbackMainModel,
} from "./managed_free_fallback.js";
export { applyProManagedInferenceDefaults } from "./vireon_account.js";
export type { InferenceMode, InferenceSessionResult, InferenceUsageStatus, OpenRouterRoute, ManagedOpenRouterCredentials } from "./inference_provider.js";
export {
  RUNTIME_PREFS_FILE,
  getRuntimePrefsPath,
  loadRuntimePreferences,
  saveRuntimePreferences,
} from "./runtime_prefs.js";
export type {
  RuntimePreferences,
  RuntimeHarnessPreferences,
  ProviderKeySource,
  InferenceModePreference,
  RuntimePersonaControls,
  RuntimePersonaProfile,
  RuntimePersonaPreferences,
} from "./runtime_prefs.js";
export {
  DEFAULT_PERSONA_UI_THEME,
  PERSONA_UI_THEME_V1,
  PERSONA_UI_THEME_V2,
  validateAndNormalizePersonaUiTheme,
  migratePersonaUiTheme,
  derivePersonaSemanticTokens,
  deriveCategoryTintsFromTheme,
  derivePersonaShellHeuristics,
  deriveDeterministicPersonaPalette,
  themeToCssVars,
  shellDefaultShowSidePanels,
  resolvePersonaPanelSides,
  shouldShowPersonaSidePanels,
  shellRootClassName,
  parseHexToRgb,
  relativeLuminance,
  contrastRatio,
  mapPersonaUiThemeToInk,
  motionPresetToStatusBarIntervalMs,
  motionPresetToCssMultipliers,
  PERSONA_CATEGORY_KEYS,
  PERSONA_OPEN_TOKEN_RANGES,
  resolveDensityScale,
  resolveRadiusPx,
  resolveMotionScale,
  resolveTypeScale,
  gradientToCss,
} from "./persona_ui_theme.js";
export type {
  PersonaGradient,
  PersonaGradientStop,
} from "./persona_ui_theme.js";
export type {
  PersonaUiThemeV1,
  PersonaUiThemeV2,
  PersonaUiTheme,
  PersonaUiMotionPreset,
  PersonaUiShell,
  PersonaUiDensity,
  PersonaUiRadius,
  PersonaUiTypography,
  PersonaUiMessageStyle,
  PersonaUiOrbStyle,
  PersonaUiBackground,
  PersonaUiFontPair,
  PersonaUiInputStyle,
  PersonaUiAvatarStyle,
  PersonaUiToolCards,
  PersonaUiMessageEntrance,
  PersonaUiHeaderStyle,
  PersonaUiPanelLayout,
  PersonaUiInputDock,
  PersonaCategoryKey,
  PersonaCategoryTint,
  PersonaSemanticTokens,
  PersonaCssVarMap,
} from "./persona_ui_theme.js";
export {
  PERSONA_UI_INVARIANTS,
  lintPersonaUi,
  repairPersonaUi,
  isPersonaUiConformant,
} from "./persona_ui_invariants.js";
export type {
  PersonaUiInvariantId,
  PersonaUiViolation,
  PersonaUiViolationSeverity,
  PersonaUiRepairResult,
} from "./persona_ui_invariants.js";
export {
  DEFAULT_PERSONA_UI_COPY,
  sanitizePersonaUiCopy,
  isDefaultPersonaUiCopy,
} from "./persona_ui_copy.js";
export type { PersonaUiCopy } from "./persona_ui_copy.js";
export {
  deriveLayoutFromTheme,
  validatePersonaLayout,
} from "./persona_ui_layout.js";
export type {
  PersonaLayoutSpec,
  PersonaComposerDock,
  PersonaHeaderStyle,
  PersonaHeaderAlign,
} from "./persona_ui_layout.js";
export {
  PERSONA_ARTIFACT_LABELS,
  PERSONA_ARTIFACT_ORDER,
} from "./persona_bootstrap_progress.js";
export type {
  PersonaArtifactId,
  PersonaArtifactStatus,
  PersonaArtifactPreview,
  PersonaProgressDetail,
  PersonaBootstrapProgressEvent,
} from "./persona_bootstrap_progress.js";
export {
  normalizePersonaControlsPatch,
  applyPersonaControlsToProfile,
  personaConfigFromRuntimeProfile,
  buildRuntimePersonaBlock,
} from "./runtime_persona_controls.js";
export {
  DEFAULT_IMAGE_ATTACHMENT_LIMITS,
  isSupportedImageMimeType,
  parseDataUrlImage,
  normalizeImageAttachmentName,
  validateImageAttachments,
  buildMessageWithImageAttachments,
} from "./image_attachments.js";
export type { ImageAttachment, ImageAttachmentLimits, ImageAttachmentSource } from "./image_attachments.js";
export {
  resolveInputShortcut,
} from "./input_semantics.js";
export type {
  InputShortcutAction,
  InputShortcutEvent,
  InputShortcutContext,
} from "./input_semantics.js";
export {
  buildRoutingProfile,
  neutralTurnInferenceResult,
  isIntentInferenceEnabled,
  applyTurnInferenceHeuristics,
} from "./intent_inference.js";
export type {
  TurnIntentClass,
  TurnInferenceResult,
  RoutingProfile,
  MemoryPolicy,
} from "./intent_inference.js";
export {
  resolveReasoningBudget,
  fallbackReasoningBudget,
  buildOpenRouterReasoningParam,
  buildReasoningBudgetInjection,
  formatReasoningBudgetTraceLine,
  resolveReasoningStallNudgeThresholdChars,
  evaluateReasoningStall,
  parseReasoningBudgetFromParsed,
  parseReasoningEffort,
  parseThinkDepth,
  applyFallbackReasoningFields,
  isReasoningBudgetClassifierEnabled,
  tightenReasoningBudgetForUserMessage,
  shouldAbortForDuplicateThinkAfterNative,
  NATIVE_DUPLICATE_THINK_CHARS,
} from "./reasoning_profile.js";
export type {
  ReasoningBudget,
  ReasoningEffort,
  ThinkDepth,
  ReasoningBudgetInferenceSlice,
  ReasoningIntentClass,
  ReasoningStallState,
  ReasoningStallAction,
} from "./reasoning_profile.js";
export {
  resolveReasoningSurface,
  shouldSendOpenRouterReasoningParam,
  effectiveThinkDepthForSurface,
  applySurfaceToBudget,
  buildReasoningSurfaceInjection,
  isImplementShipUserMessage,
  isResearchFreshnessUserMessage,
  isBuildDeliverableUserMessage,
} from "./reasoning_surface.js";
export type {
  ReasoningSurface,
  ReasoningSurfaceResolution,
  ReasoningSurfaceSource,
} from "./reasoning_surface.js";
export { SharedMemoryBus } from "./shared_memory_bus.js";
export type { BusListener, SharedBusEnvelope } from "./shared_memory_bus.js";
export {
  resolveShellRuntime,
  getShellNote,
  getPlatformIdentity,
  gatherGitContext,
  scanActiveDevPorts,
  shellProtocolGuidance,
} from "./platform_context.js";
export type {
  ShellRuntime,
  PlatformIdentity,
  GitContext,
  PortContext,
} from "./platform_context.js";
export { gatherExternalTerminalSnapshots } from "./terminal_snapshot.js";
export type { TerminalSnapshotSummary } from "./terminal_snapshot.js";
export {
  bumpRuleHits,
  extractRuleIds,
  formatRuleStatsReport,
  ruleStatsPath,
} from "./rule_stats.js";
export type { RuleStatEntry, RuleStats } from "./rule_stats.js";
export { ToolDag } from "./tool_dag.js";
export type { DagSpec, DagEdge } from "./tool_dag.js";
export { SessionToolIndex } from "./session_tool_index.js";
export type { ToolOutputEntry, ToolOutputQueryResult } from "./session_tool_index.js";
export {
  ResearchLedger,
  canonicalUrl,
  unwrapSearchRedirect,
  extractUrls,
} from "./research_ledger.js";
export type {
  UrlStatus,
  UrlRecord,
  QueryRecord,
  LedgerSummary,
} from "./research_ledger.js";
export {
  minePatternsFromSessions,
  isSpeculatable,
  defaultSessionRoots,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MIN_SUPPORT,
} from "./paste_pattern_miner.js";
export type { PatternRecord, MineOptions } from "./paste_pattern_miner.js";
export {
  loadPatternStore,
  savePatternStore,
  buildContextKey,
  queryPatterns,
  predictNextTools,
  getCachedPatternStore,
  refreshPatternStoreCache,
  patternStorePath,
} from "./paste_pattern_store.js";
export type { PatternQueryResult } from "./paste_pattern_store.js";
export { PasteScheduler } from "./paste_scheduler.js";
export type {
  SpeculationCandidate,
  InFlightSpeculation,
  SchedulerOptions,
} from "./paste_scheduler.js";
export { maybeWriteTrajectory } from "./trajectory_writer.js";
export type { TrajectoryEntry, TrajectoryWriteInput } from "./trajectory_writer.js";
export { scoreTurnOutcome, recordEffortOutcome, getBestEffortForIntent, formatEffortStatsReport } from "./outcome_scorer.js";
export type { TurnOutcomeInput } from "./outcome_scorer.js";
export { WorldContextRefresher, gatherVolatileSnapshot, diffVolatileSnapshots } from "./world_context_delta.js";
export type { VolatileSnapshot } from "./world_context_delta.js";
export { extractFacts, extractFactsRaw, publishToolFacts, readBusFacts } from "./fact_extractor.js";
export type { ExtractedFact } from "./fact_extractor.js";
export {
  inferSpawnToolFamiliesFromChildConfig,
  mapContractToToolFamilies,
  TOOL_FAMILY_DESCRIPTORS,
} from "./contract_tool_mapper.js";
export type { ContractFamilyMapping, SpawnFamilyInferenceInput } from "./contract_tool_mapper.js";
export type { ToolFamilyDescriptor } from "./contract_tool_mapper.js";
export {
  applySpawnToolInference,
  buildSpawnToolInferencePrompt,
  inferSpawnToolsWithFastModel,
  parseSpawnToolInferencePayload,
} from "./spawn_tool_inference.js";
export type { SpawnToolInferenceResult } from "./spawn_tool_inference.js";
export {
  SPAWN_DISCOVERY_TOOL_NAMES,
  SPAWN_COLLABORATION_TOOL_NAMES,
  ensureSpawnDiscoveryTools,
  ensureSpawnCollaborationTools,
  activateSpawnContractAllowlist,
  buildUpstreamDependencyContext,
  buildSharedBusContext,
  buildSpawnContextInjection,
  finalizeChildSpawnTools,
  ensureChildBaselineTools,
  SPAWN_BASELINE_TOOL_NAMES,
} from "./spawn_provisioning.js";
export {
  ENTITLEMENTS,
  COMMUNITY_ENTITLEMENTS,
  LICENSE_TIERS,
  VIREON_LICENSE_PUBLIC_KEY_PEM,
  ENTITLEMENT_GATED_FAMILIES,
  entitlementsForTier,
  parseLicenseToken,
  verifyLicenseToken,
  signLicenseToken,
  resolveEntitlements,
  loadResolvedEntitlements,
  hasEntitlement,
  gateFamiliesByEntitlements,
  isFamilyEntitled,
  readCachedLicenseToken,
  writeCachedLicenseToken,
  licenseCachePath,
} from "./entitlements.js";
export {
  readVireonAccount,
  writeVireonAccount,
  applyVireonLicenseToken,
  clearVireonAccount,
  resolveLicenseTokenForHarness,
  loadHarnessEntitlements,
  defaultVireonSiteOrigin,
  vireonAccountPath,
} from "./vireon_account.js";
export type { VireonAccountRecord } from "./vireon_account.js";
export { runVireonConnectFlow } from "./vireon_connect.js";
export type { VireonConnectResult, RunVireonConnectOptions } from "./vireon_connect.js";
export {
  loadEnterpriseModule,
  wireEnterpriseEdition,
  linkEnterpriseHostDependencies,
  resolveEnterpriseRoots,
  enterpriseInstallDir,
  enterpriseManifestPath,
  entrypointForRoot,
} from "./enterprise_loader.js";
export type {
  EnterpriseModule,
  EnterpriseWireInput,
  EnterpriseLoadResult,
  EnterpriseWireResult,
  WireEnterpriseEditionResult,
} from "./enterprise_loader.js";
export {
  ensureEnterpriseEditionInstalled,
  wireEnterpriseWithInstall,
  tierRequiresEnterprisePackage,
} from "./enterprise_install.js";
export type { EnterpriseInstallResult, EnterpriseManifest } from "./enterprise_install.js";
export {
  ensureManagedInferenceSession,
  clearManagedInferenceSessionCache,
  isManagedInferenceBaseUrl,
} from "./inference_session.js";
export {
  readOAuthBundle,
  writeOAuthBundle,
  listOAuthAccounts,
  deleteOAuthBundle,
  sanitizeOAuthAccountId,
} from "./oauth_store.js";
export type { OAuthTokenBundle } from "./oauth_store.js";
export {
  googleOAuthClientConfig,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  refreshGoogleAccessToken,
  getGoogleAccessToken,
  revokeGoogleAccount,
  listGoogleOAuthAccounts,
} from "./oauth_broker.js";
export { loadHarnessEnvFiles } from "./load_harness_env.js";
export { countOAuthAccountFiles, oauthDecryptHint } from "./oauth_diagnostics.js";
export {
  oauthMailboxQualityScore,
  pickBestOAuthAccountByEmail,
  resolveMailProviderFromEnv,
  resolvePreferredMailProvider,
  formatPreferredMailRouteLine,
} from "./oauth_mail_routing.js";
export type { MailProviderId, PreferredMailRoute, OAuthAccountRef } from "./oauth_mail_routing.js";
export {
  GOOGLE_WORKSPACE_SERVICES,
  ALL_GOOGLE_SERVICE_IDS,
  GOOGLE_OAUTH_SCOPES_FULL,
  getGoogleServicePreset,
  resolveGoogleServices,
  scopesForGoogleServices,
  apiScopesForGoogleServices,
  needsGoogleSidecar,
  sidecarServiceIds,
  GOOGLE_SIDECAR_SERVICE_IDS,
  workspaceMcpToolNamesForServices,
  GOOGLE_OFFICIAL_MCP_API_IDS,
  googleCloudMcpApiLibraryUrl,
  googleProjectIdFromClientId,
  isGmailOfficialMcpConnection,
} from "./connector_catalog.js";
export {
  missingGoogleScopes,
  requiredScopesForPresets,
  formatGoogleScopeDiagnostics,
  missingDefaultWorkspaceScopes,
  normalizeGoogleScope,
  normalizeGoogleScopes,
} from "./google_oauth_scopes.js";
export type { GoogleServiceId, GoogleServicePreset, ConnectorBackend } from "./connector_catalog.js";
export { runGoogleConnectFlow, buildGoogleAuthUrlForWeb } from "./google_connect.js";
export type { GoogleConnectResult, RunGoogleConnectFlowOptions } from "./google_connect.js";
export {
  microsoftOAuthClientConfig,
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  refreshMicrosoftAccessToken,
  getMicrosoftAccessToken,
  revokeMicrosoftAccount,
  listMicrosoftOAuthAccounts,
  microsoftTenantId,
} from "./microsoft_oauth_broker.js";
export {
  MICROSOFT_WORKSPACE_SERVICES,
  ALL_MICROSOFT_SERVICE_IDS,
  MICROSOFT_OAUTH_SCOPES_FULL,
  MICROSOFT_GRAPH_CONNECTION,
  getMicrosoftServicePreset,
  resolveMicrosoftServices,
  scopesForMicrosoftServices,
  apiScopesForMicrosoftServices,
  needsMicrosoftSidecar,
  microsoftSidecarServiceIds,
} from "./microsoft_connector_catalog.js";
export {
  missingMicrosoftScopes,
  requiredScopesForMicrosoftPresets,
  formatMicrosoftScopeDiagnostics,
  missingDefaultMicrosoftScopes,
  normalizeMicrosoftScope,
  normalizeMicrosoftScopes,
} from "./microsoft_oauth_scopes.js";
export type { MicrosoftServiceId, MicrosoftServicePreset, MicrosoftConnectorBackend } from "./microsoft_connector_catalog.js";
export {
  runMicrosoftConnectFlow,
  buildMicrosoftAuthUrlForWeb,
  microsoftOAuthLoopbackHost,
  microsoftOAuthCallbackUri,
} from "./microsoft_connect.js";
export type { MicrosoftConnectResult, RunMicrosoftConnectFlowOptions } from "./microsoft_connect.js";
export {
  xeroOAuthClientConfig,
  buildXeroAuthUrl,
  exchangeXeroCode,
  refreshXeroAccessToken,
  getXeroAccessToken,
  revokeXeroAccount,
  listXeroOAuthAccounts,
  fetchXeroConnections,
  resolveXeroTenantId,
  scopesForXeroMode,
  XERO_DEFAULT_MODE,
} from "./xero_oauth_broker.js";
export type { XeroTenantConnection, XeroMode } from "./xero_oauth_broker.js";
export {
  isHostedOAuthHandoffUri,
  hostedOAuthHandoffPath,
  buildHostedIntegrationConnectUrl,
  applyHostedOAuthHandoff,
  isHostedOAuthFormHandoffContent,
  parseHostedOAuthHandoffHttpBody,
  runHostedIntegrationConnectFlow,
} from "./hosted_oauth_connect.js";
export type {
  HostedOAuthHandoffPayload,
  ParsedHostedOAuthHandoffBody,
  HostedIntegrationConnectResult,
  RunHostedIntegrationConnectOptions,
} from "./hosted_oauth_connect.js";
export {
  runXeroHostedConnectFlow,
} from "./xero_connect.js";
export type { XeroConnectResult, RunXeroHostedConnectOptions } from "./xero_connect.js";
export { runGoogleHostedConnectFlow } from "./google_hosted_connect.js";
export type { RunGoogleHostedConnectOptions } from "./google_hosted_connect.js";
export { runMicrosoftHostedConnectFlow } from "./microsoft_hosted_connect.js";
export type { RunMicrosoftHostedConnectOptions } from "./microsoft_hosted_connect.js";
export type {
  LicenseTier,
  EntitlementKey,
  LicensePayload,
  EntitlementStatus,
  ResolvedEntitlements,
  VerifyResult,
  ResolveEntitlementsOptions,
} from "./entitlements.js";
