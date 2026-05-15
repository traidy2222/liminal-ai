export { resolveWorkspaceRoot } from "./workspace_root.js";
export {
  runHarnessEffectiveEnvContext,
  resolveHarnessEnvRaw,
  effectiveHarnessEnvRaw,
  effectiveHarnessEnvString,
  harnessEnvResolutionMeta,
} from "./harness_effective_env.js";
export type { HarnessEnvResolutionSource } from "./harness_effective_env.js";
export { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";
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
export { gatherRepoMapLines } from "./repo_map.js";
export type { RepoMapOptions } from "./repo_map.js";
export { guardToolArgs } from "./tool_arg_guard.js";
export {
  tokenize,
  rankDocumentsForQuery,
  memoryTypeBoost,
  recencyBoost,
  trustBoost,
  spacedRepetitionDecay,
} from "./memory_rank.js";
export type { RankableDoc } from "./memory_rank.js";
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
export { getFastModelSlug, completeChatJson } from "./router.js";
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
export { rewriteQueryForRecall } from "./query_rewrite.js";
export type { RewriteQueryResult } from "./query_rewrite.js";
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
} from "./execution_state.js";
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
export {
  attachSessionEventLog,
  maybeAttachSessionEventLog,
  writeYieldSnapshot,
  resolveSessionTextLogMode,
  sessionTraceLogEnabled,
} from "./session_event_log.js";
export type { YieldSnapshot } from "./session_event_log.js";
export { appendGoldenEvalRecord } from "./golden_eval.js";
export { resolveProviderConfig, resolveVisionProviderConfig } from "./provider_config.js";
export type { ProviderConfig, ProviderConfigOverrides, VisionProviderConfig } from "./provider_config.js";
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
  RuntimePersonaControls,
  RuntimePersonaProfile,
  RuntimePersonaPreferences,
} from "./runtime_prefs.js";
export {
  DEFAULT_PERSONA_UI_THEME,
  PERSONA_UI_THEME_VERSION,
  validateAndNormalizePersonaUiTheme,
  parseHexToRgb,
  relativeLuminance,
  contrastRatio,
  mapPersonaUiThemeToInk,
  motionPresetToStatusBarIntervalMs,
  motionPresetToCssMultipliers,
} from "./persona_ui_theme.js";
export type { PersonaUiThemeV1, PersonaUiMotionPreset } from "./persona_ui_theme.js";
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
