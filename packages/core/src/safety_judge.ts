/**
 * Advisory safety classifier: heuristics + optional single-token LLM (0/1)
 * to skip human approval for clearly safe tool calls when enabled.
 */
import path from "node:path";
import type OpenAI from "openai";
import { guardToolArgs } from "./tool_arg_guard.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { withProviderRequestSpacing } from "./provider_request_gate.js";
import { buildOpenRouterSessionExtras } from "./openrouter_session.js";

export type SafetyJudgeSource = "heuristic" | "llm" | "cache";

/** Source stored in cache (never `cache`). */
type SafetyJudgeOrigin = "heuristic" | "llm";

/** When true, the dispatcher may skip the user approval prompt. */
export type SafetyJudgeVerdict = "safe" | "require_human";

export interface SafetyJudgeConfig {
  /** Chat model id (OpenRouter slug or OpenAI model). */
  model: string;
  /** LLM call timeout in ms. Default 4000. */
  timeoutMs?: number;
  /** In-process cache TTL. Default 300_000 (5 min). */
  cacheTtlMs?: number;
  /**
   * If true, unknown/timeout/parse-failure after LLM tier auto-skips approval (unsafe).
   * Default false: fail closed → require human.
   */
  failOpen?: boolean;
}

export interface SafetyClassification {
  verdict: SafetyJudgeVerdict;
  source: SafetyJudgeSource;
}

interface CacheEntry {
  verdict: SafetyJudgeVerdict;
  source: SafetyJudgeOrigin;
  expiresAt: number;
}

const SHELL_ALLOW_PATTERNS: RegExp[] = [
  /^git\s+(status|diff|log|branch|show)(\s|$)/i,
  /^ls(\s|$)/i,
  /^dir(\s|$)/i,
  /^get-childitem(\s|$)/i,
  /^pwd\s*$/i,
  /^get-location\s*$/i,
  /^whoami\s*$/i,
  /^node\s+(-v|--version)(\s|$)/i,
  /^npm\s+test(\s|$)/i,
  /^npm\s+run\s+typecheck(\s|$)/i,
  /^npx\s+tsc\s+--noEmit(\s|$)/i,
  /^cat\s+/i,
  /^type\s+/i,
  /^get-content\s+/i,
  /^echo\s+/i,
  /^which\s+/i,
  /^where(\.exe)?\s+/i,
];

function stableStringify(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) sorted[k] = obj[k];
  return JSON.stringify(sorted);
}

function heuristicShell(command: string): SafetyJudgeVerdict | null {
  const cmd = command.trim();
  if (!cmd) return "require_human";
  if (guardToolArgs("run_shell", { command: cmd })) return "require_human";
  for (const re of SHELL_ALLOW_PATTERNS) {
    if (re.test(cmd)) return "safe";
  }
  return null;
}

function heuristicWriteFile(
  args: Record<string, unknown>,
  cwd: string
): SafetyJudgeVerdict | null {
  if (guardToolArgs("write_file", args)) return "require_human";

  const filePath = String(args["path"] ?? "");
  const raw = filePath.trim();
  if (!raw) return "require_human";

  const resolved = path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.join(cwd, raw));
  const rel = path.relative(path.normalize(cwd), resolved);
  const escapes =
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    rel.split(path.sep).includes("..");

  if (escapes) return null;

  const lower = resolved.replace(/\\/g, "/").toLowerCase();
  if (
    lower.includes("/.ssh/") ||
    lower.endsWith("/.ssh") ||
    lower.includes("/etc/shadow") ||
    lower.includes("/etc/sudoers") ||
    lower.endsWith("id_rsa") ||
    lower.endsWith("id_ed25519")
  ) {
    return "require_human";
  }

  const base = path.basename(resolved).toLowerCase();
  if (base === ".env" || base === ".env.local" || base === ".env.production") {
    return null;
  }

  return "safe";
}

function parseLlmBit(content: string | null | undefined): SafetyJudgeVerdict | null {
  if (content == null) return null;
  const m = content.match(/\S/);
  if (!m) return null;
  const c = m[0];
  if (c === "0") return "safe";
  if (c === "1") return "require_human";
  return null;
}

export class SafetyJudge {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly failOpen: boolean;

  constructor(
    private readonly client: OpenAI,
    private readonly cfg: SafetyJudgeConfig
  ) {
    this.timeoutMs = cfg.timeoutMs ?? 4000;
    this.cacheTtlMs = cfg.cacheTtlMs ?? 300_000;
    this.failOpen = cfg.failOpen ?? false;
  }

  /**
   * Classify whether human approval can be skipped.
   * `guardToolArgs` is assumed to have already passed in the dispatcher.
   */
  async classify(
    toolName: string,
    args: Record<string, unknown>,
    batchToolNames?: string[]
  ): Promise<SafetyClassification> {
    const cacheKey = `${toolName}:${stableStringify(args)}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() < hit.expiresAt) {
      return { verdict: hit.verdict, source: "cache" };
    }

    const heur = this.heuristicTier(toolName, args);
    if (heur !== null) {
      this.setCache(cacheKey, heur.verdict, heur.source);
      return heur;
    }

    const llmVerdict = await this.llmTier(toolName, args, batchToolNames);
    const source: SafetyJudgeOrigin = "llm";
    let verdict: SafetyJudgeVerdict;
    if (llmVerdict === null) {
      verdict = this.failOpen ? "safe" : "require_human";
    } else {
      verdict = llmVerdict;
    }
    this.setCache(cacheKey, verdict, source);
    return { verdict, source };
  }

  private setCache(
    key: string,
    verdict: SafetyJudgeVerdict,
    source: SafetyJudgeOrigin
  ): void {
    this.cache.set(key, {
      verdict,
      source,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  /** Returns null = uncertain → LLM tier. */
  private heuristicTier(
    toolName: string,
    args: Record<string, unknown>
  ): { verdict: SafetyJudgeVerdict; source: "heuristic" } | null {
    if (toolName === "run_shell" || toolName === "run_background") {
      const command = String(args["command"] ?? "");
      const h = heuristicShell(command);
      if (h === null) return null;
      return { verdict: h, source: "heuristic" };
    }
    if (toolName === "write_file") {
      const h = heuristicWriteFile(args, resolveWorkspaceRoot());
      if (h === null) return null;
      return { verdict: h, source: "heuristic" };
    }
    return null;
  }

  private async llmTier(
    toolName: string,
    args: Record<string, unknown>,
    batchToolNames?: string[]
  ): Promise<SafetyJudgeVerdict | null> {
    const argsJson = stableStringify(args);
    const truncated =
      argsJson.length > 1500 ? `${argsJson.slice(0, 1500)}…(truncated)` : argsJson;
    const batch = (batchToolNames ?? []).join(", ");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await withProviderRequestSpacing(
        { apiKey: this.client.apiKey, baseURL: this.client.baseURL },
        () =>
          this.client.chat.completions.create(
            {
              model: this.cfg.model,
              temperature: 0,
              max_tokens: 2,
              messages: [
                {
                  role: "system",
                  content:
                    "You are a binary safety classifier. Reply with exactly one character: " +
                    "`1` if the tool call is destructive (irreversible writes/deletes outside the project, " +
                    "system or credential changes, exfiltration, executing remote code, exposing secrets, " +
                    "opening network attack surface). Otherwise reply `0`. No prose.",
                },
                {
                  role: "user",
                  content: `tool: ${toolName}\nargs: ${truncated}\nrecent batch: ${batch || "(none)"}`,
                },
              ],
              ...buildOpenRouterSessionExtras(this.client.baseURL),
            },
            { signal: controller.signal }
          )
      );

      const text = res.choices[0]?.message?.content;
      return parseLlmBit(text);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
