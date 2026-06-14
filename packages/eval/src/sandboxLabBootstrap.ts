/**
 * Per-scenario isolated workspace for sandbox capability lab evals.
 *
 * Copies seeded fixtures into a throwaway temp tree and pins AGENT_WORKSPACE_ROOT
 * there. Memory notes use legacy workspace-local `.agent_notes.json` inside the
 * temp tree (AGENT_STORAGE_LAYOUT=legacy) so we avoid redirecting
 * AGENT_GLOBAL_STORAGE_ROOT — that path caused huge cross-workspace memory priming.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SandboxPathContext {
  sandboxRoot?: string;
}

const EVAL_PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(EVAL_PKG_ROOT, "../..");
const TSC_BIN = path.join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");

export interface SandboxLabSession {
  root: string;
  env: Record<string, string>;
  cleanup: () => void;
}

/** Eval/sandbox latency trims — real tools, fewer sidecar LLM passes and context bloat. */
export const SANDBOX_SPEED_ENV: Record<string, string> = {
  AGENT_WORLD_CONTEXT: "0",
  AGENT_INTENT_INFERENCE: "0",
  AGENT_INTENT_REPO_CONTEXT: "0",
  AGENT_REASONING_BUDGET: "0",
  AGENT_PROACTIVE_VERIFY: "0",
  AGENT_PROACTIVE_VERIFY_LINT: "0",
  AGENT_SESSION_JSONL: "0",
  AGENT_UI_VERBOSITY: "quiet",
  AGENT_OBSIDIAN_DISCOVER: "0",
  AGENT_EFFORT: "low",
};

/** Default harness env for sandbox runs — auto-approve tools, lean context. */
export function sandboxLabDefaultEnv(root: string): Record<string, string> {
  return {
    AGENT_WORKSPACE_ROOT: root,
    AGENT_STORAGE_LAYOUT: "legacy",
    AGENT_YOLO: "1",
    AGENT_TOOL_LAZY: "1",
    AGENT_SELF_HEAL_LINT: "0",
    AGENT_RULE_RECALL: "0",
    AGENT_MEMORY_GRAPH: "0",
    AGENT_MEMORY_PRIME_ROUND0: "0",
    AGENT_CTX_HOT_ROUNDS: "2",
    AGENT_CTX_WARM_ROUNDS: "2",
    ...SANDBOX_SPEED_ENV,
  };
}

export function prepareSandboxLab(fixtureId: string): SandboxLabSession {
  const fixtureSrc = path.join(EVAL_PKG_ROOT, "fixtures", "sandbox", fixtureId);
  if (!existsSync(fixtureSrc)) {
    throw new Error(`Sandbox fixture not found: ${fixtureId} (${fixtureSrc})`);
  }
  const root = mkdtempSync(path.join(tmpdir(), `liminal-sandbox-${fixtureId}-`));
  cpSync(fixtureSrc, root, { recursive: true });
  return {
    root,
    env: sandboxLabDefaultEnv(root),
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

export function sandboxPath(ctx: SandboxPathContext | undefined, rel: string): string {
  if (!ctx?.sandboxRoot) throw new Error("sandboxRoot missing from ScenarioRunContext");
  return path.join(ctx.sandboxRoot, rel);
}

export function readSandboxText(ctx: SandboxPathContext | undefined, rel: string): string | null {
  if (!ctx?.sandboxRoot) return null;
  const abs = path.join(ctx.sandboxRoot, rel);
  if (!existsSync(abs)) return null;
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

export function sandboxFileExists(ctx: SandboxPathContext | undefined, rel: string): boolean {
  if (!ctx?.sandboxRoot) return false;
  return existsSync(path.join(ctx.sandboxRoot, rel));
}

/** Run the monorepo TypeScript compiler against an isolated fixture workspace. */
export function sandboxTscClean(ctx: SandboxPathContext | undefined): boolean {
  if (!ctx?.sandboxRoot || !existsSync(TSC_BIN)) return false;
  const tsconfig = path.join(ctx.sandboxRoot, "tsconfig.json");
  if (!existsSync(tsconfig)) return false;
  try {
    execSync(`node "${TSC_BIN}" --noEmit -p "${tsconfig}"`, {
      cwd: ctx.sandboxRoot,
      stdio: "pipe",
      timeout: 90_000,
    });
    return true;
  } catch {
    return false;
  }
}
