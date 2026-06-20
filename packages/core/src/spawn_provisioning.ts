/**
 * Sub-agent spawn provisioning — tool activation, discovery essentials,
 * and curated context bundles for dependency chains and shared bus handoffs.
 */
import type { ToolRegistry } from "./registry.js";
import type { TaskOrchestrator } from "./orchestrator.js";
import type { SharedMemoryBus, SharedBusEnvelope } from "./shared_memory_bus.js";
import type { ChildAgentConfig, SubagentSpawnContract } from "./types.js";

const DEFAULT_SPAWN_SUCCESS_CRITERIA = [
  "Address the objective directly with no unnecessary scope expansion.",
  "Include concrete evidence or repository references for major claims.",
  "Return output formatted for parent-agent merge.",
] as const;

/**
 * Fill missing spawn-contract fields when the model passes a partial object.
 * Prevents forkChild from throwing on undefined successCriteria / objective.
 */
export function normalizeSpawnContract(
  partial: Partial<SubagentSpawnContract>,
  fallback: { goal: string; userPrompt?: string; systemPrompt?: string }
): SubagentSpawnContract {
  const objective =
    partial.objective?.trim() ||
    fallback.userPrompt?.trim() ||
    fallback.goal.trim() ||
    "Complete the assigned subtask.";
  const role = partial.role?.trim() || "specialist_executor";
  const deliverableFormat =
    partial.deliverableFormat?.trim() ||
    (fallback.systemPrompt?.trim()
      ? "Follow system_prompt output contract exactly."
      : "Concise markdown with findings, evidence, and explicit caveats.");
  return {
    role,
    objective,
    deliverableFormat,
    successCriteria:
      Array.isArray(partial.successCriteria) && partial.successCriteria.length > 0
        ? partial.successCriteria.map((s) => String(s))
        : [...DEFAULT_SPAWN_SUCCESS_CRITERIA],
    nonGoals: partial.nonGoals,
    allowedTools: partial.allowedTools,
    handoffRequirements: partial.handoffRequirements,
    budget: partial.budget,
  };
}

export const SPAWN_DISCOVERY_TOOL_NAMES = ["list_tool_families", "activate_tool_family"] as const;
export const SPAWN_COLLABORATION_TOOL_NAMES = ["share_agent_context", "read_agent_context"] as const;

/** Minimum tool surface every sub-agent must have under lazy loading (mirrors CORE_ALWAYS_TOOLS_BASE). */
export const SPAWN_BASELINE_TOOL_NAMES = [
  "think",
  "read_file",
  "grep_file",
  "write_file",
  "edit_file",
  "list_dir",
  "list_tool_families",
  "activate_tool_family",
] as const;

const SPAWN_BASELINE_SET = new Set<string>(SPAWN_BASELINE_TOOL_NAMES);

/** True when spawn text implies the child must deliver file artifacts (not chat-only research). */
const FILE_DELIVERABLE_OBJECTIVE_RE =
  /\b(save|write|create|output|deliver|produce|draft|persist)\b[\s\S]{0,48}\b(file|files|document|markdown|\.md|\.txt|report|notes?|path)\b|\b(file|files|document|markdown|\.md|\.txt|report)\b[\s\S]{0,48}\b(save|write|create|to|under|into)\b/i;

export function isSpawnBaselineTool(name: string): boolean {
  return SPAWN_BASELINE_SET.has(name);
}

export function spawnObjectiveNeedsFileTools(cfg: ChildAgentConfig): boolean {
  const text = [
    cfg.spawnContract?.objective,
    cfg.userPrompt,
    cfg.taskBrief,
    cfg.goal,
    cfg.systemPrompt,
  ]
    .filter(Boolean)
    .join("\n");
  return FILE_DELIVERABLE_OBJECTIVE_RE.test(text);
}

/**
 * Copy baseline tools from parent → child even when `toolNames` is a restrictive allowlist.
 * Without this, research spawns that pass tools=[web_search,…] leave write_file unregistered.
 */
export function ensureChildRegistryBaselineFromParent(
  parent: ToolRegistry,
  child: ToolRegistry
): string[] {
  const registered: string[] = [];
  for (const name of SPAWN_BASELINE_TOOL_NAMES) {
    if (child.has(name)) continue;
    const tool = parent.get(name);
    if (tool) {
      child.register(tool);
      registered.push(name);
    }
  }
  return registered;
}

export function ensureChildBaselineTools(registry: ToolRegistry): string[] {
  const names = SPAWN_BASELINE_TOOL_NAMES.filter((n) => registry.has(n));
  return registry.activate(names);
}

function provisionFileDeliverableTools(registry: ToolRegistry, cfg: ChildAgentConfig): string[] {
  if (!spawnObjectiveNeedsFileTools(cfg)) return [];
  return registry.activateFamilies(["files_edit"]);
}

export function ensureSpawnDiscoveryTools(registry: ToolRegistry): string[] {
  return registry.activate([...SPAWN_DISCOVERY_TOOL_NAMES]);
}

export function ensureSpawnCollaborationTools(registry: ToolRegistry): string[] {
  return registry.activate([...SPAWN_COLLABORATION_TOOL_NAMES]);
}

/** Map spawn-contract allowedTools to family activation + explicit tool names. */
export function activateSpawnContractAllowlist(
  registry: ToolRegistry,
  allowedTools?: readonly string[]
): { families: string[]; tools: string[] } {
  if (!allowedTools?.length) return { families: [], tools: [] };
  const famSet = new Set<string>();
  for (const name of allowedTools) {
    const fam = registry.getSuggestedFamilyForTool(name);
    if (fam) famSet.add(fam);
  }
  const families = [...famSet];
  for (const fam of families) registry.activateFamilies([fam]);
  const tools = registry.activate([...allowedTools]);
  return { families, tools };
}

function formatEnvelope(key: string, env: SharedBusEnvelope): string {
  const body = (env.payload?.trim() || env.summary).slice(0, 4000);
  return `[${key} · ${env.type}]\n${body}`;
}

/** Collect outputs from depends_on upstream tasks (orchestrator + handoff bus). */
export function buildUpstreamDependencyContext(
  orchestrator: TaskOrchestrator,
  sharedBus: SharedMemoryBus,
  fallbackParentTaskId: string,
  dependsOn?: readonly string[]
): string {
  if (!dependsOn?.length) return "";
  const parts: string[] = [];
  for (const depId of dependsOn) {
    const dep = orchestrator.get(depId);
    if (!dep) continue;
    const header = `[UPSTREAM AGENT ${depId.slice(0, 8)} — ${dep.goal} — ${dep.status}]`;
    if (dep.result?.trim()) {
      parts.push(`${header}\n${dep.result.trim().slice(0, 8000)}`);
    }
    const parentId = dep.parentTaskId ?? fallbackParentTaskId;
    const handoffKey = `spawn/${parentId}/${depId}/handoff`;
    const env = sharedBus.readEnvelope(handoffKey);
    if (env?.payload?.trim()) {
      parts.push(`${header} [structured handoff]\n${env.payload.trim().slice(0, 4000)}`);
    } else if (env?.summary?.trim()) {
      parts.push(`${header} [handoff summary]\n${env.summary.trim().slice(0, 2000)}`);
    }
  }
  if (parts.length === 0) return "";
  return `[DEPENDENCY CONTEXT — upstream agent outputs]\n\n${parts.join("\n\n---\n\n")}`;
}

/** Read explicit keys and/or a key prefix from the session shared bus. */
export function buildSharedBusContext(
  sharedBus: SharedMemoryBus,
  opts?: { keys?: readonly string[]; prefix?: string; maxChars?: number }
): string {
  const max = opts?.maxChars ?? 12_000;
  const parts: string[] = [];
  const seen = new Set<string>();
  const keys = opts?.keys ?? [];

  for (const key of keys) {
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    const env = sharedBus.readEnvelope(key);
    if (env) {
      parts.push(formatEnvelope(key, env));
      continue;
    }
    const raw = sharedBus.read(key);
    if (raw?.trim()) parts.push(`[${key}]\n${raw.trim().slice(0, 3000)}`);
  }

  const pfx = opts?.prefix?.trim();
  if (pfx) {
    for (const [key, raw] of Object.entries(sharedBus.getAll())) {
      if (!key.startsWith(pfx) || seen.has(key)) continue;
      seen.add(key);
      try {
        const parsed = JSON.parse(raw) as SharedBusEnvelope;
        if (parsed?.type && typeof parsed.summary === "string") {
          parts.push(formatEnvelope(key, parsed));
          continue;
        }
      } catch {
        /* plain string value */
      }
      parts.push(`[${key}]\n${raw.slice(0, 2000)}`);
    }
  }

  const joined = parts.join("\n\n---\n\n");
  return joined.length > 0 ? `[SHARED AGENT CONTEXT]\n\n${joined.slice(0, max)}` : "";
}

/** Merge dependency + shared-bus context blocks for injection before child send(). */
export function buildSpawnContextInjection(
  orchestrator: TaskOrchestrator,
  sharedBus: SharedMemoryBus,
  parentTaskId: string,
  cfg: ChildAgentConfig
): string {
  const blocks = [
    buildUpstreamDependencyContext(orchestrator, sharedBus, parentTaskId, cfg.dependsOn),
    buildSharedBusContext(sharedBus, {
      keys: cfg.contextKeys,
      prefix: cfg.contextBusPrefix,
    }),
  ].filter(Boolean);
  return blocks.join("\n\n");
}

/**
 * Final synchronous tool provisioning for a child registry (lazy mode).
 * Call after BM25 family inference and before the first completion request.
 */
export function finalizeChildSpawnTools(
  registry: ToolRegistry,
  cfg: ChildAgentConfig,
  opts: { canOrchestrate: boolean }
): {
  activeCount: number;
  discoveryActivated: string[];
  collaborationActivated: string[];
  contractAllowlist: { families: string[]; tools: string[] };
} {
  const contractAllowlist = activateSpawnContractAllowlist(
    registry,
    cfg.spawnContract?.allowedTools
  );

  if (cfg.activateFamilies?.length) {
    registry.activateFamilies(cfg.activateFamilies);
  }
  if (cfg.activateTools?.length) {
    registry.activate(cfg.activateTools);
  }

  provisionFileDeliverableTools(registry, cfg);
  ensureChildBaselineTools(registry);

  const discoveryActivated = ensureSpawnDiscoveryTools(registry);
  const collaborationActivated = ensureSpawnCollaborationTools(registry);

  if (opts.canOrchestrate) {
    registry.activateFamilies(["orchestration"]);
  }

  return {
    activeCount: registry.getActiveToolNames().length,
    discoveryActivated,
    collaborationActivated,
    contractAllowlist,
  };
}
