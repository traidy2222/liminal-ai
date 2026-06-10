/**
 * Recipe library — generalized successful-strategy patterns.
 *
 * A recipe is keyed by `(intent class, phase shape)`, NOT a literal tool trace.
 * The phase shape is the turn's tool sequence collapsed onto a small phase
 * taxonomy (LOCATE / MUTATE / VERIFY / …), so structurally-similar successful
 * turns compound onto ONE entry instead of spawning near-duplicate ×1 recipes.
 *
 * Only turns that scored well (outcome >= RECIPE_OUTCOME_FLOOR) are recorded.
 * Persisted to `.agent_recipe_stats.json` under the `recipes` key — the file is
 * shared with outcome_scorer's `effort_stats`, so load/save preserve all keys.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { rankDocumentsForQuery, type RankableDoc } from "./memory_rank.js";
import {
  ensureGlobalStorageRoot,
  pickReadPath,
  pickWritePath,
  recipeStatsPaths,
} from "./global_storage.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { isEmailComposeTurn } from "./email_compose_context.js";

/** A turn must score at least this (scoreTurnOutcome, 0–1) to become a recipe. */
const RECIPE_OUTCOME_FLOOR = 0.6;

/** A recipe is "promoted" to a default plan when it has compounded enough times AND its avg outcome is high. */
const PROMOTE_MIN_COUNT = 5;
const PROMOTE_MIN_OUTCOME = 0.8;

// ─── Phase taxonomy ───────────────────────────────────────────────────────────

export type RecipePhase =
  | "LOCATE"
  | "RESEARCH"
  | "REASON"
  | "MUTATE"
  | "EXECUTE"
  | "VERIFY"
  | "MEMORY"
  | "GIT"
  | "ORCHESTRATE"
  | "DOCUMENT"
  | "OTHER";

/** Explicit tool → phase map. Unknown tools fall back to prefix rules / OTHER. */
const TOOL_PHASE: Readonly<Record<string, RecipePhase>> = {
  // LOCATE — find / read code and files
  read_file: "LOCATE", read_file_chunked: "LOCATE", read_file_with_imports: "LOCATE",
  grep_file: "LOCATE", list_dir: "LOCATE", repo_map: "LOCATE", ast_grep: "LOCATE",
  symbol_index: "LOCATE", find_references: "LOCATE", file_metadata: "LOCATE",
  workspace_snapshot: "LOCATE",
  // RESEARCH — external information
  web_search: "RESEARCH", web_fetch: "RESEARCH", http_request: "RESEARCH",
  weather_lookup: "RESEARCH", markets_quote: "RESEARCH",
  // REASON — planning / inference
  think: "REASON", reason: "REASON", plan: "REASON", hypothesize: "REASON",
  breakdown: "REASON", decompose_goal: "REASON", branch_explore: "REASON",
  branch_evaluate: "REASON",
  // MUTATE — change the workspace
  write_file: "MUTATE", edit_file: "MUTATE", multi_file_apply: "MUTATE",
  move_file: "MUTATE", copy_file: "MUTATE", copy_tree: "MUTATE", mkdir_p: "MUTATE",
  path_guard: "MUTATE", rename_symbol: "MUTATE",
  // EXECUTE — run processes
  run_shell: "EXECUTE", run_background: "EXECUTE", open_terminal: "EXECUTE", execute_code: "EXECUTE",
  run_command_with_pty: "EXECUTE", kill_process: "EXECUTE", list_processes: "EXECUTE",
  read_process_output: "EXECUTE",
  // VERIFY — check correctness
  run_tests: "VERIFY", run_lint: "VERIFY", verify_result: "VERIFY",
  verify_contract: "VERIFY", evidence_critic: "VERIFY", path_critic: "VERIFY",
  policy_critic: "VERIFY", reflect_debate: "VERIFY",
  // MEMORY — store / retrieve knowledge
  remember: "MEMORY", recall: "MEMORY", recall_type: "MEMORY", recall_relevant: "MEMORY",
  recall_compression: "MEMORY", search_memory: "MEMORY", memory_query: "MEMORY",
  memory_graph: "MEMORY", memory_consolidate: "MEMORY", memory_stats: "MEMORY",
  read_artifact: "MEMORY", failure_review: "MEMORY", self_telemetry: "MEMORY",
  // ORCHESTRATE — sub-agents
  spawn_agent: "ORCHESTRATE", wait_for_agents: "ORCHESTRATE", cancel_agent: "ORCHESTRATE",
  list_agents: "ORCHESTRATE", synthesis_run: "ORCHESTRATE", dispatch_graph: "ORCHESTRATE",
  query_tool_outputs: "ORCHESTRATE",
};

function phaseForTool(tool: string): RecipePhase {
  const explicit = TOOL_PHASE[tool];
  if (explicit) return explicit;
  if (tool.startsWith("doc_")) return "DOCUMENT";
  if (tool.startsWith("git_")) return "GIT";
  if (tool.startsWith("browser_") || tool === "captcha_solve") return "RESEARCH";
  if (tool.startsWith("vault_")) return "MEMORY";
  if (tool.startsWith("memory_") || tool.startsWith("recall") || tool.startsWith("forget")) return "MEMORY";
  return "OTHER";
}

/**
 * Collapse a turn's ordered tool list into its phase shape: the ordered list of
 * distinct phases, first-occurrence order, fully deduplicated.
 */
export function phaseShapeForTools(tools: readonly string[]): RecipePhase[] {
  const seen = new Set<RecipePhase>();
  const shape: RecipePhase[] = [];
  for (const t of tools) {
    const p = phaseForTool(t);
    if (!seen.has(p)) {
      seen.add(p);
      shape.push(p);
    }
  }
  return shape;
}

// ─── Recipe model + persistence ───────────────────────────────────────────────

export interface RecipeExample {
  goal: string;
  toolSequence: string;
  outcome: number;
}

export interface RecipeEntry {
  /** `${intentClass}::${phaseShape joined by →}` */
  key: string;
  intentClass: string;
  phaseShape: RecipePhase[];
  count: number;
  outcomeSum: number;
  outcomeCount: number;
  toolUnion: string[];
  bestExample: RecipeExample;
  firstAt: string;
  lastAt: string;
}

/** The recipe-stats file also carries outcome_scorer's `effort_stats` — preserve all keys. */
interface StatsFile {
  recipes?: Record<string, RecipeEntry>;
  [k: string]: unknown;
}

async function loadFile(): Promise<StatsFile> {
  try {
    const p = await pickReadPath(recipeStatsPaths());
    const raw = await readFile(p, "utf8");
    const j = JSON.parse(raw) as unknown;
    return j && typeof j === "object" ? (j as StatsFile) : {};
  } catch {
    return {};
  }
}

async function saveFile(file: StatsFile): Promise<void> {
  await ensureGlobalStorageRoot();
  const p = await pickWritePath(recipeStatsPaths());
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, JSON.stringify(file, null, 2), "utf8");
}

export interface RecordRecipeInput {
  intentClass: string;
  /** Ordered tool names used in the turn. */
  tools: readonly string[];
  /** The user goal / trigger for the turn. */
  goal: string;
  /** Turn outcome score from scoreTurnOutcome (0–1). */
  outcome: number;
}

/**
 * Record a successful turn as a recipe. Merges onto the existing `(intent,
 * phase-shape)` entry when one exists (count + outcome compound); inserts
 * otherwise. No-ops for low-outcome turns or when the library is disabled.
 */
export async function recordRecipe(input: RecordRecipeInput): Promise<void> {
  if (effectiveHarnessEnvRaw("AGENT_RECIPE_LIBRARY") === "0") return;
  if (input.outcome < RECIPE_OUTCOME_FLOOR) return;
  if (input.tools.length < 2) return;

  const shape = phaseShapeForTools(input.tools);
  if (shape.length === 0) return;
  const intent = (input.intentClass || "general").trim().toLowerCase() || "general";
  const key = `${intent}::${shape.join("→")}`;
  const goal = input.goal.replace(/\s+/g, " ").trim().slice(0, 160) || "(untitled)";
  const toolSequence = input.tools.join(" → ");
  const now = new Date().toISOString();

  const file = await loadFile();
  const recipes = file.recipes ?? {};
  const prev = recipes[key];

  if (prev) {
    prev.count += 1;
    prev.outcomeSum += input.outcome;
    prev.outcomeCount += 1;
    prev.lastAt = now;
    prev.toolUnion = [...new Set([...prev.toolUnion, ...input.tools])].slice(0, 30);
    if (input.outcome >= prev.bestExample.outcome) {
      prev.bestExample = { goal, toolSequence, outcome: input.outcome };
    }
    recipes[key] = prev;
  } else {
    recipes[key] = {
      key,
      intentClass: intent,
      phaseShape: shape,
      count: 1,
      outcomeSum: input.outcome,
      outcomeCount: 1,
      toolUnion: [...new Set(input.tools)].slice(0, 30),
      bestExample: { goal, toolSequence, outcome: input.outcome },
      firstAt: now,
      lastAt: now,
    };
  }
  file.recipes = recipes;
  await saveFile(file);
}

function avgOutcome(r: RecipeEntry): number {
  return r.outcomeCount > 0 ? r.outcomeSum / r.outcomeCount : 0.5;
}

/**
 * Plan-skeleton hint for world context: the recipe(s) most worth reusing for
 * the current goal, ranked by relevance × log(reuse) × avg outcome.
 */
export async function formatRecipeLibraryHints(
  seed: string,
  intentClass?: string
): Promise<string | null> {
  if (effectiveHarnessEnvRaw("AGENT_RECIPE_LIBRARY") === "0") return null;
  if (isEmailComposeTurn(seed)) return null;
  const file = await loadFile();
  const all = Object.values(file.recipes ?? {});
  if (all.length === 0) return null;

  const intent = intentClass?.trim().toLowerCase();
  const pool = intent ? all.filter((r) => r.intentClass === intent) : [];
  const candidates = pool.length > 0 ? pool : all;

  const trimmed = seed.trim();
  const relevance = new Map<number, number>();
  if (trimmed.length >= 6) {
    const docs: RankableDoc[] = candidates.map((r, i) => ({
      id: String(i),
      text: r.bestExample.goal,
    }));
    for (const h of rankDocumentsForQuery(trimmed, docs, { limit: docs.length })) {
      relevance.set(parseInt(h.id, 10), h.score);
    }
  }

  const scored = candidates
    .map((r, i) => {
      const avg = avgOutcome(r);
      const rel = relevance.get(i) ?? 0;
      return { r, avg, score: Math.log1p(r.count) * avg * (1 + rel) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  if (scored.length === 0) return null;
  const isPromoted = (r: RecipeEntry, avg: number): boolean =>
    r.count >= PROMOTE_MIN_COUNT && avg >= PROMOTE_MIN_OUTCOME;
  const topPromoted = isPromoted(scored[0]!.r, scored[0]!.avg);
  const header = topPromoted
    ? "[DEFAULT PLAN] established play for this kind of task — follow it unless the task is structurally different:"
    : "[KNOWN RECIPE] proven strategy for this kind of task — use as the plan skeleton unless the task clearly differs:";
  const lines = [header];
  for (const { r, avg } of scored) {
    const tag = isPromoted(r, avg) ? " [DEFAULT]" : "";
    lines.push(`  • ${r.phaseShape.join(" → ")}  (reused ×${r.count}, avg outcome ${avg.toFixed(2)})${tag}`);
    lines.push(`    e.g. "${r.bestExample.goal}" → ${r.bestExample.toolSequence}`);
  }
  return lines.join("\n");
}

/** Top recipes by reuse — for the `self_telemetry` tool. */
export async function formatTopRecipes(topN = 10): Promise<string> {
  try {
    const file = await loadFile();
    const all = Object.values(file.recipes ?? {});
    if (all.length === 0) return "(no recipes recorded yet)";
    all.sort((a, b) => b.count - a.count);
    const top = all.slice(0, Math.max(1, topN));
    const lines = [`[RECIPE LIBRARY] ${all.length} recipe(s); top ${top.length} by reuse:`];
    for (const r of top) {
      lines.push(
        `  - (×${r.count}, avg ${avgOutcome(r).toFixed(2)}) ${r.key}\n` +
          `      e.g. "${r.bestExample.goal}"`
      );
    }
    return lines.join("\n");
  } catch {
    return "(recipe library unavailable)";
  }
}
