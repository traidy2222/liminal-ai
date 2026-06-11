/**
 * Fast-model inference for sub-agent tool provisioning at spawn time.
 *
 * Given spawn context (goal, user_prompt, system_prompt, contract), picks the
 * tool families and optional explicit tools the child needs on its first turn.
 * Runs once per forkChild (before send()) when lazy loading is on; BM25
 * pre-activation in forkChild remains as a zero-cost baseline.
 */
import type OpenAI from "openai";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { TOOL_FAMILY_DESCRIPTORS } from "./contract_tool_mapper.js";
import type { ToolRegistry } from "./registry.js";
import type { ChildAgentConfig } from "./types.js";
import { spawnObjectiveNeedsFileTools } from "./spawn_provisioning.js";

export interface SpawnToolInferenceResult {
  families: string[];
  activateTools: string[];
  rationale: string;
  source: "llm" | "skipped" | "failed";
}

const KNOWN_FAMILIES = new Set(TOOL_FAMILY_DESCRIPTORS.map((d) => d.family));

function inferEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_SPAWN_TOOL_INFER") !== "0";
}

function inferTimeoutMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_SPAWN_TOOL_INFER_TIMEOUT_MS");
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(30_000, n) : 8_000;
}

function inferModelSlug(mainModel: string): string {
  const override = effectiveHarnessEnvRaw("AGENT_SPAWN_TOOL_INFER_MODEL")?.trim();
  return override && override.length > 0 ? override : getFastModelSlug(mainModel);
}

function spawnObjective(cfg: ChildAgentConfig): string {
  return (
    cfg.spawnContract?.objective.trim() ||
    cfg.userPrompt?.trim() ||
    cfg.taskBrief?.trim() ||
    cfg.goal.trim() ||
    ""
  );
}

function spawnRole(cfg: ChildAgentConfig): string {
  return cfg.spawnContract?.role.trim() || cfg.systemPrompt?.trim().slice(0, 800) || "";
}

function buildFamilyCatalog(): string {
  return TOOL_FAMILY_DESCRIPTORS.map(
    (d) => `- ${d.family}: ${d.description}`
  ).join("\n");
}

export function buildSpawnToolInferencePrompt(cfg: ChildAgentConfig, parentActiveSample?: string[]): string {
  const objective = spawnObjective(cfg);
  const role = spawnRole(cfg);
  const lines: string[] = [
    "You provision tools for a sub-agent about to start work.",
    "Return JSON ONLY (no markdown):",
    '{"tool_families":["family_id",...],"activate_tools":["tool_name",...],"rationale":"≤120 chars"}',
    "",
    "Rules:",
    "- Pick 1–5 tool_families the sub-agent needs for its FIRST turn (not everything).",
    "- tool_families must be ids from the catalog below.",
    "- activate_tools: optional specific tool names when a family alone is insufficient (e.g. run_tests, run_lint, browser_open). Omit when empty.",
    "- Prefer minimal sufficient capability — read-only analysts need not get shell or write tools.",
    "- Coding tasks: files_edit + code_intel (+ shell when build/test needed).",
    "- Web research: web (+ memory_advanced when vault/recall helps).",
    "- Browser UI work: browser (+ vision for screenshots).",
    "",
    "Tool family catalog:",
    buildFamilyCatalog(),
  ];
  if (cfg.toolNames?.length) {
    lines.push("", `RESTRICTION: sub-agent allowlist ONLY these tools: ${cfg.toolNames.join(", ")}.`);
    lines.push("Pick families/tools that are subsets of the allowlist.");
  }
  if (cfg.activateTools?.length) {
    lines.push("", `Parent already requested activate_tools: ${cfg.activateTools.join(", ")} — include these plus any gaps.`);
  }
  if (parentActiveSample?.length) {
    lines.push("", `Parent currently active tools (sample): ${parentActiveSample.slice(0, 24).join(", ")}`);
  }
  lines.push(
    "",
    `Goal label: ${cfg.goal.slice(0, 200)}`,
    role ? `Role / system_prompt:\n${role}` : "",
    `Task / user_prompt:\n${objective.slice(0, 2500)}`
  );
  return lines.filter(Boolean).join("\n");
}

export function parseSpawnToolInferencePayload(raw: unknown): Omit<SpawnToolInferenceResult, "source"> {
  const empty = { families: [] as string[], activateTools: [] as string[], rationale: "" };
  if (!raw || typeof raw !== "object") return empty;
  const o = raw as Record<string, unknown>;

  const families: string[] = [];
  if (Array.isArray(o["tool_families"])) {
    for (const x of o["tool_families"]) {
      if (typeof x !== "string") continue;
      const id = x.trim().toLowerCase();
      if (KNOWN_FAMILIES.has(id) && !families.includes(id)) families.push(id);
    }
  }

  const activateTools: string[] = [];
  if (Array.isArray(o["activate_tools"])) {
    for (const x of o["activate_tools"]) {
      if (typeof x !== "string") continue;
      const name = x.trim();
      if (/^[a-z][a-z0-9_]{0,63}$/.test(name) && !activateTools.includes(name)) {
        activateTools.push(name);
      }
    }
  }

  const rationale =
    typeof o["rationale"] === "string" ? o["rationale"].trim().slice(0, 200) : "";

  if (!families.includes("files_edit") && families.length > 0) {
    // Baseline file access for most subtasks unless allowlist excludes all file tools.
    families.push("files_edit");
  }

  return { families, activateTools, rationale };
}

export async function inferSpawnToolsWithFastModel(
  client: OpenAI,
  mainModel: string,
  cfg: ChildAgentConfig,
  opts?: { parentActiveTools?: string[] }
): Promise<SpawnToolInferenceResult> {
  if (!inferEnabled()) {
    return { families: [], activateTools: [], rationale: "infer_disabled", source: "skipped" };
  }
  const objective = spawnObjective(cfg);
  if (!objective.trim()) {
    return { families: [], activateTools: [], rationale: "empty_objective", source: "skipped" };
  }

  try {
    const jr = await completeChatJson(client, {
      model: inferModelSlug(mainModel),
      messages: [
        {
          role: "system",
          content:
            "You are a tool provisioning planner for autonomous sub-agents. " +
            "Output strict JSON only — no prose outside the JSON object.",
        },
        {
          role: "user",
          content: buildSpawnToolInferencePrompt(cfg, opts?.parentActiveTools),
        },
      ],
      maxTokens: 280,
      temperature: 0.1,
      signal: AbortSignal.timeout(inferTimeoutMs()),
    });

    if (!jr.ok || typeof jr.parsed !== "object" || jr.parsed == null) {
      return {
        families: [],
        activateTools: [],
        rationale: jr.ok ? "invalid_json" : jr.error.slice(0, 120),
        source: "failed",
      };
    }

    const parsed = parseSpawnToolInferencePayload(jr.parsed);
    if (spawnObjectiveNeedsFileTools(cfg)) {
      if (!parsed.families.includes("files_edit")) parsed.families.push("files_edit");
      for (const t of ["write_file", "edit_file", "read_file", "grep_file"] as const) {
        if (!parsed.activateTools.includes(t)) parsed.activateTools.push(t);
      }
    }
    return { ...parsed, source: "llm" };
  } catch (err) {
    return {
      families: [],
      activateTools: [],
      rationale: err instanceof Error ? err.message.slice(0, 120) : "infer_error",
      source: "failed",
    };
  }
}

/** Apply LLM inference result to a child registry (lazy mode). Returns newly activated tool names. */
export function applySpawnToolInference(
  registry: ToolRegistry,
  result: SpawnToolInferenceResult,
  cfg: ChildAgentConfig
): { familiesActivated: string[]; toolsActivated: string[] } {
  if (!registry.isLazyToolLoading() || result.source !== "llm") {
    return { familiesActivated: [], toolsActivated: [] };
  }

  let families = result.families;
  let tools = result.activateTools;

  if (cfg.toolNames?.length) {
    const allow = new Set(cfg.toolNames);
    tools = tools.filter((t) => allow.has(t));
    // Families: only keep those that have at least one allowlisted tool registered.
    families = families.filter((fam) =>
      [...registry.getToolNames()].some((t) => allow.has(t) && registry.getSuggestedFamilyForTool(t) === fam)
    );
  }

  const familiesActivated: string[] = [];
  for (const fam of families) {
    const newly = registry.activateFamilies([fam]);
    if (newly.length > 0) familiesActivated.push(fam);
  }

  const toolsActivated = registry.activate(tools);
  return { familiesActivated, toolsActivated };
}
