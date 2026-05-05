export { resolveWorkspaceRoot } from "./workspace_root.js";
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
} from "./types.js";
export { getFastModelSlug, completeChatJson } from "./router.js";
export type { JsonCompletionResult } from "./router.js";
export { rewriteQueryForRecall } from "./query_rewrite.js";
export type { RewriteQueryResult } from "./query_rewrite.js";
export {
  emptyEpistemicState,
  mergeEpistemicState,
  renderEpistemicStateBlock,
  markEpistemicPlanStepDone,
  mergeExtractedSubgoals,
  subgoalsFromPlanSteps,
} from "./epistemic_state.js";
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
export { attachSessionEventLog, maybeAttachSessionEventLog } from "./session_event_log.js";
export { appendGoldenEvalRecord } from "./golden_eval.js";
