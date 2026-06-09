import type { ToolResult, ToolParameterSchema, PropertySchema, ApprovalDecision } from "./types.js";
import type { AgentEmitter } from "./events.js";
import type { ToolRegistry } from "./registry.js";
import type { TaskOrchestrator } from "./orchestrator.js";
import { guardToolArgs } from "./tool_arg_guard.js";
import { coerceArgsToSchema, coerceJsonArrayValue } from "./tool_arg_coerce.js";
import type { SafetyJudge } from "./safety_judge.js";
import { stableArgsJsonKey } from "./json_stable.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { LAZY_AUTO_ACTIVATE_TOOL_ONLY } from "./tool_lazy_constants.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";

function autoApproveToolSet(): Set<string> {
  const raw = effectiveHarnessEnvRaw("AGENT_AUTO_APPROVE_TOOLS")?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

// ─── Schema validation (#5 — Tool Invocation Reliability arXiv:2601.16280) ────

/**
 * Recursively validate a single value against a PropertySchema.
 * Checks: type, enum, numeric range, string length, array items, nested objects.
 */
function validateValue(key: string, val: unknown, schema: PropertySchema): string | null {
  if (schema.anyOf && schema.anyOf.length > 0) {
    let lastErr: string | null = null;
    for (const branch of schema.anyOf) {
      const e = validateValue(key, val, { ...branch, anyOf: undefined });
      if (e === null) return null;
      lastErr = e;
    }
    return lastErr ?? `Field "${key}": value did not match allowed variants`;
  }
  // Type check
  if (schema.type) {
    const actual = Array.isArray(val) ? "array" : typeof val;
    if (actual !== schema.type) {
      return `Field "${key}": expected ${schema.type}, got ${actual}`;
    }
  }
  // Enum check
  if (schema.enum !== undefined && !schema.enum.includes(val)) {
    return `Field "${key}": must be one of [${schema.enum.map(String).join(", ")}], got "${String(val)}"`;
  }
  // Numeric range
  if (typeof val === "number") {
    if (schema.minimum !== undefined && val < schema.minimum)
      return `Field "${key}": ${val} is below minimum ${schema.minimum}`;
    if (schema.maximum !== undefined && val > schema.maximum)
      return `Field "${key}": ${val} exceeds maximum ${schema.maximum}`;
  }
  // String length
  if (typeof val === "string") {
    if (schema.minLength !== undefined && val.length < schema.minLength)
      return `Field "${key}": string too short (min ${schema.minLength})`;
    if (schema.maxLength !== undefined && val.length > schema.maxLength)
      return `Field "${key}": string too long (max ${schema.maxLength})`;
  }
  // Array items
  if (Array.isArray(val) && schema.items) {
    for (let i = 0; i < val.length; i++) {
      const err = validateValue(`${key}[${i}]`, val[i], schema.items);
      if (err) return err;
    }
  }
  // Nested object
  if (schema.type === "object" && schema.properties && typeof val === "object" && val !== null) {
    for (const [nestedKey, nestedSchema] of Object.entries(schema.properties)) {
      const nestedVal = (val as Record<string, unknown>)[nestedKey];
      if (nestedVal !== undefined) {
        const err = validateValue(`${key}.${nestedKey}`, nestedVal, nestedSchema);
        if (err) return err;
      }
    }
  }
  return null;
}

/** Common model hallucinations → registered tool names. */
const TOOL_NAME_ALIASES: Readonly<Record<string, string>> = {
  repository_map: "repo_map",
};

function resolveToolName(name: string): string {
  return TOOL_NAME_ALIASES[name] ?? name;
}

/** Per-tool arg aliases applied before JSON-schema validation. */
function normalizeToolArgs(
  name: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (name === "speak") {
    const out = { ...args };
    const text = String(out["text"] ?? "").trim();
    const content = String(out["content"] ?? "").trim();
    if (!text && content) {
      out["text"] = content;
      delete out["content"];
    }
    return out;
  }
  if (name === "docs_rest_write_blocks" && "blocks" in args) {
    return { ...args, blocks: coerceJsonArrayValue(args["blocks"]) };
  }
  if (name === "docs_rest_batch_update" && "requests" in args) {
    return { ...args, requests: coerceJsonArrayValue(args["requests"]) };
  }
  if (name === "docs_rest_insert_table" && "rows" in args) {
    return { ...args, rows: coerceJsonArrayValue(args["rows"]) };
  }
  return args;
}

function validateArgs(
  schema: ToolParameterSchema,
  args: Record<string, unknown>
): string | null {
  // Required fields
  for (const field of schema.required ?? []) {
    if (!(field in args)) {
      return `Missing required field: "${field}"`;
    }
  }
  // additionalProperties: false — reject unknown keys
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!(key in schema.properties)) {
        return `Unknown field "${key}" (not allowed by tool schema)`;
      }
    }
  }
  // Per-property deep validation
  for (const [key, val] of Object.entries(args)) {
    const propSchema = schema.properties[key];
    if (!propSchema) continue;
    const err = validateValue(key, val, propSchema);
    if (err) return err;
  }
  return null;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export type FileWriteDispatchHooks = {
  prepareArgs: (
    callId: string,
    name: string,
    args: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  onRejected: (callId: string, name: string) => void;
};

const CIRCUIT_FAIL_THRESHOLD = 3;
const CIRCUIT_OPEN_TTL_MS = 30_000;

export class ToolDispatcher {
  /**
   * Per-dispatcher result cache for cacheable tools (#6 — Tool Cache Agent).
   * Keyed by `${toolName}:${stableArgsKey}`, value includes result + expiry timestamp.
   */
  private readonly resultCache = new Map<string, { result: ToolResult; expiresAt: number }>();

  /**
   * In-flight coalescing for identical cacheable calls (stable args, no approval gate).
   */
  private readonly inflight = new Map<string, Promise<ToolResult>>();

  /** Circuit breaker: track consecutive failure streaks and open-circuit timestamps per tool. */
  private readonly failStreaks = new Map<string, number>();
  private readonly circuitOpenUntil = new Map<string, number>();

  private vaultWritesThisTurn = 0;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly emitter: AgentEmitter,
    private readonly orchestrator?: TaskOrchestrator,
    private readonly taskId?: string,
    private readonly safetyJudge?: SafetyJudge,
    private readonly approvalTimeoutMs: number = 60_000,
    private readonly autoApproveDestructive: boolean = false,
    private readonly preDispatchPolicy?: (
      toolName: string,
      args: Record<string, unknown>
    ) => { ok: true } | { ok: false; reason: string; severity: "low" | "med" | "high" },
    private readonly dryRunApprovals: boolean = false,
  ) {}

  private fileWriteHooks?: FileWriteDispatchHooks;
  /** Per-turn trace ID set by agent.ts at send() start for event correlation. */
  private turnTraceId?: string;
  /** Current ReAct round index (0-based) — set by agent.ts each round for causality tracking. */
  private turnRoundIndex?: number;

  setFileWriteHooks(hooks: FileWriteDispatchHooks | undefined): void {
    this.fileWriteHooks = hooks;
  }

  /** Set per-turn trace ID and initial round index. Call at send() start; clear with undefined on finish. */
  setTurnTraceId(id: string | undefined): void {
    this.turnTraceId = id;
    this.turnRoundIndex = id ? 0 : undefined;
  }

  /** Advance the round counter; call once per ReAct round from agent.ts. */
  advanceTurnRound(): void {
    if (this.turnRoundIndex !== undefined) this.turnRoundIndex += 1;
  }

  /** Emit tool_result with optional traceId + roundIndex for event correlation. */
  private emitToolResult(
    callId: string,
    name: string,
    args: Record<string, unknown>,
    result: import("./types.js").ToolResult
  ): void {
    this.emitter.emit("tool_result", {
      callId,
      name,
      args,
      result,
      ...(this.turnTraceId ? { traceId: this.turnTraceId } : {}),
      ...(this.turnRoundIndex !== undefined ? { roundIndex: this.turnRoundIndex } : {}),
    });
  }

  resetTurnCounters(): void {
    this.vaultWritesThisTurn = 0;
  }

  /**
   * After a successful workspace mutation, drop cached read/index results so the next
   * tool call sees fresh disk state (read_file cache TTL would otherwise serve stale bodies).
   */
  invalidateCachesAfterFileWrites(): void {
    const prefixes = [
      "read_file:",
      "read_file_chunked:",
      "file_metadata:",
      "list_dir:",
      "symbol_index:",
      "find_references:",
      "ast_grep:",
      "repo_map:",
    ];
    for (const key of [...this.resultCache.keys()]) {
      if (prefixes.some((p) => key.startsWith(p))) this.resultCache.delete(key);
    }
  }

  /**
   * Call a tool directly, bypassing approval/locking/events.
   * Used internally by the harness for housekeeping (reflexion, recipes).
   */
  async directCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    name = resolveToolName(name);
    const tool = this.registry.get(name);
    if (!tool) return { ok: false, error: `Unknown tool: "${name}"` };
    args = normalizeToolArgs(name, args);
    args = coerceArgsToSchema(tool.parameters, args);
    const guardMsg = guardToolArgs(name, args);
    if (guardMsg) return { ok: false, error: `[ARG GUARD] ${guardMsg}` };
    try {
      const emit = (text: string) => this.emitter.emit("text", { delta: text, channel: "trace" });
      return await tool.handler(args, emit);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async dispatch(
    callId: string,
    name: string,
    argsJson: string,
    /** Names of all tools being called in the same round (for pre-flight checks). */
    batchToolNames?: string[]
  ): Promise<ToolResult> {
    name = resolveToolName(name);
    const tool = this.registry.get(name);
    if (!tool) {
      return { ok: false, error: `Unknown tool: "${name}"` };
    }

    if (!this.registry.isActive(name)) {
      // Auto-activate on miss. The model called a registered-but-inactive tool;
      // it has already decided it needs this capability, so failing the round
      // (the old behavior) just burned a turn and a telemetry event. Activate
      // the tool's family transparently and fall through to normal dispatch —
      // schema validation below still catches any guessed args.
      const fam = this.registry.getSuggestedFamilyForTool(name);
      const newly =
        fam && !LAZY_AUTO_ACTIVATE_TOOL_ONLY.has(name)
          ? this.registry.activateFamilies([fam])
          : this.registry.activate([name]);
      this.emitter.emit("text", {
        delta:
          `[TOOL_AUTO_ACTIVATE] "${name}" was inactive — activated ` +
          `${fam ? `family "${fam}"` : "tool"} (${newly.length} tool(s) now visible).\n`,
        channel: "trace",
      });
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsJson) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        error: `Invalid JSON args for tool "${name}": ${argsJson}`,
      };
    }
    args = normalizeToolArgs(name, args);
    args = coerceArgsToSchema(tool.parameters, args);

    // Circuit breaker: reject if this tool's circuit is open due to repeated failures.
    const circuitOpenUntilTs = this.circuitOpenUntil.get(name) ?? 0;
    if (Date.now() < circuitOpenUntilTs) {
      const remainMs = circuitOpenUntilTs - Date.now();
      const result: ToolResult = {
        ok: false,
        error: `Tool "${name}" circuit is open after ${CIRCUIT_FAIL_THRESHOLD} consecutive failures — cooling down for ${Math.ceil(remainMs / 1000)}s. Replan or try a different approach.`,
      };
      this.emitter.emit("tool_circuit_open", { name, remainMs });
      this.emitToolResult(callId, name, args, result);
      return result;
    }

    // Schema validation before execution (#5 deep validation)
    const validationError = validateArgs(tool.parameters, args);
    if (validationError) {
      const result: ToolResult = {
        ok: false,
        error: `Invalid args for "${name}": ${validationError}`,
      };
      this.emitToolResult(callId, name, args, result);
      return result;
    }

    const guardMsg = guardToolArgs(name, args);
    if (guardMsg) {
      const result: ToolResult = { ok: false, error: `[ARG GUARD] ${guardMsg}` };
      this.emitToolResult(callId, name, args, result);
      return result;
    }
    if (this.preDispatchPolicy) {
      const decision = this.preDispatchPolicy(name, args);
      if (!decision.ok) {
        this.emitter.emit("contract_violation", {
          toolName: name,
          reason: decision.reason,
          severity: decision.severity,
        });
        const result: ToolResult = {
          ok: false,
          error: `Blocked by runtime policy: ${decision.reason}`,
        };
        this.emitToolResult(callId, name, args, result);
        return result;
      }
    }
    if (name === "vault_write") {
      const budget = Math.max(
        1,
        Math.min(50, parseInt(effectiveHarnessEnvRaw("AGENT_VAULT_WRITE_BUDGET") ?? "8", 10) || 8)
      );
      if (this.vaultWritesThisTurn >= budget) {
        this.emitter.emit("vault_activity", {
          action: "skip_write",
          ok: false,
          reason: `vault_write_budget_exceeded_${budget}`,
        });
        const result: ToolResult = {
          ok: false,
          error: `vault_write budget exceeded for this send (${budget}). Consolidate notes before writing more.`,
        };
        this.emitToolResult(callId, name, args, result);
        return result;
      }
    }

    const stableCacheKey = tool.cacheable ? `${name}:${stableArgsJsonKey(JSON.stringify(args))}` : "";
    // Approval policy: only destructive tools require explicit human approval.
    // Cautious tools stay guarded by schema + arg guards + optional safety judge.
    const requiresHumanApproval = tool.requiresApproval && tool.dangerLevel === "destructive";

    // Result cache lookup (#6 — Tool Cache Agent, stable key ignores JSON key order)
    if (stableCacheKey) {
      const cached = this.resultCache.get(stableCacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        this.emitToolResult(callId, name, args, cached.result);
        return cached.result;
      }
    }

    // Acquire resource locks if declared. Prefix each lock ID with the harness's
    // workspace root so two sub-agents on different worktrees don't false-share
    // a `file:write:src/foo.ts` lock just because the relative paths collide.
    const rawResourceIds = tool.resourceLocks?.(args) ?? [];
    const wsRoot = resolveWorkspaceRoot();
    const resourceIds = rawResourceIds.map((id) => `ws:${wsRoot}::${id}`);
    if (resourceIds.length > 0 && this.orchestrator) {
      const acquired = await this.orchestrator.locks.acquireAll(
        resourceIds,
        this.taskId ?? "root"
      );
      if (!acquired) {
        const holders = resourceIds
          .map((r) => {
            const h = this.orchestrator!.locks.getHolders(r);
            return h.length > 0 ? `${r} (held by: ${h.join(",")})` : r;
          })
          .join("; ");
        const result: ToolResult = {
          ok: false,
          error: `Resource locked by another agent: ${holders}. Wait for the other agent to finish, or work on a different resource.`,
        };
        this.emitToolResult(callId, name, args, result);
        return result;
      }
    }

    try {
      if (
        tool.requiresApproval &&
        autoApproveToolSet().has(name) &&
        !this.dryRunApprovals &&
        !this.autoApproveDestructive
      ) {
        this.emitter.emit("approval_decision", {
          callId,
          name,
          decision: "approve",
        });
      } else if (requiresHumanApproval) {
        if (this.dryRunApprovals) {
          // Dry-run mode: auto-approve without blocking; emit approval_simulated for observability.
          this.emitter.emit("approval_simulated", {
            callId,
            name,
            args,
            ...(this.turnTraceId ? { traceId: this.turnTraceId } : {}),
          });
        } else if (this.autoApproveDestructive) {
          // Session-only YOLO: bypass interactive approval while preserving audit visibility.
          this.emitter.emit("approval_decision", {
            callId,
            name,
            decision: "approve",
          });
        } else {
        let skipHumanApproval = false;
        if (this.safetyJudge) {
          const { verdict, source } = await this.safetyJudge.classify(
            name,
            args,
            batchToolNames
          );
          this.emitter.emit("safety_check", { callId, name, source, verdict });
          skipHumanApproval = verdict === "safe";
        }

        if (!skipHumanApproval) {
          const decision = await this.requestApproval(callId, name, args);
          // Emit approval decision for audit trail (#7 Structured Event Log)
          this.emitter.emit("approval_decision", {
            callId,
            name,
            decision: decision.decision,
            ...(decision.decision === "edit" && { editedArgs: decision.editedArgs }),
          });
          if (decision.decision === "reject") {
            this.fileWriteHooks?.onRejected(callId, name);
            const result: ToolResult = {
              ok: false,
              error: `Tool "${name}" rejected by user: ${decision.reason}`,
            };
            this.emitToolResult(callId, name, args, result);
            return result;
          }
          if (decision.decision === "edit") {
            args = coerceArgsToSchema(tool.parameters, normalizeToolArgs(name, decision.editedArgs));
            const reErr = validateArgs(tool.parameters, args);
            if (reErr) {
              const result: ToolResult = {
                ok: false,
                error: `Edited args for "${name}" failed validation: ${reErr}`,
              };
              this.emitToolResult(callId, name, args, result);
              return result;
            }
            const reGuard = guardToolArgs(name, args);
            if (reGuard) {
              const result: ToolResult = { ok: false, error: `[ARG GUARD] ${reGuard}` };
              this.emitToolResult(callId, name, args, result);
              return result;
            }
          }
        }
        }
      }

      if (this.fileWriteHooks) {
        args = coerceArgsToSchema(
          tool.parameters,
          normalizeToolArgs(name, await this.fileWriteHooks.prepareArgs(callId, name, args))
        );
        const reErr = validateArgs(tool.parameters, args);
        if (reErr) {
          const result: ToolResult = {
            ok: false,
            error: `Invalid args for "${name}" after stream prepare: ${reErr}`,
          };
          this.emitToolResult(callId, name, args, result);
          return result;
        }
      }

      const runHandler = async (): Promise<ToolResult> => {
        const t0 = Date.now();
        const emit = (text: string) => this.emitter.emit("text", { delta: text, channel: "trace" });
        const result = await tool.handler(args, emit);
        this.emitter.emit("tool_timing", { callId, name, durationMs: Date.now() - t0 });
        return result;
      };

      const cacheKeyForRun = tool.cacheable ? `${name}:${stableArgsJsonKey(JSON.stringify(args))}` : "";

      let result: ToolResult;
      if (cacheKeyForRun && !requiresHumanApproval) {
        let work = this.inflight.get(cacheKeyForRun);
        if (!work) {
          work = runHandler();
          this.inflight.set(cacheKeyForRun, work);
          work.finally(() => {
            if (this.inflight.get(cacheKeyForRun) === work) this.inflight.delete(cacheKeyForRun);
          });
        }
        result = await work;
      } else {
        result = await runHandler();
      }

      // Enforce per-tool output size cap (maxOutputTokens * 4 chars ≈ token count)
      if (result.ok && tool.maxOutputTokens) {
        const charCap = tool.maxOutputTokens * 4;
        if (result.output.length > charCap) {
          result = {
            ok: true,
            output: result.output.slice(0, charCap) + `\n[OUTPUT TRUNCATED — exceeded ${tool.maxOutputTokens} token limit. Use a more targeted query or request a specific range.]`,
          };
        }
      }

      // Store successful result in cache if cacheable (#6)
      if (tool.cacheable && result.ok && cacheKeyForRun) {
        const ttl = tool.cacheTtlMs ?? 30_000;
        this.resultCache.set(cacheKeyForRun, { result, expiresAt: Date.now() + ttl });
      }

      this.emitToolResult(callId, name, args, result);
      if (name === "vault_write" && result.ok) {
        this.vaultWritesThisTurn += 1;
      }
      // Circuit breaker: reset streak on success, increment on failure.
      if (result.ok) {
        this.failStreaks.delete(name);
        this.circuitOpenUntil.delete(name);
      } else {
        const streak = (this.failStreaks.get(name) ?? 0) + 1;
        this.failStreaks.set(name, streak);
        if (streak >= CIRCUIT_FAIL_THRESHOLD) {
          this.circuitOpenUntil.set(name, Date.now() + CIRCUIT_OPEN_TTL_MS);
          this.emitter.emit("tool_circuit_open", { name, remainMs: CIRCUIT_OPEN_TTL_MS });
        }
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const result: ToolResult = { ok: false, error };
      this.emitToolResult(callId, name, args, result);
      const streak = (this.failStreaks.get(name) ?? 0) + 1;
      this.failStreaks.set(name, streak);
      if (streak >= CIRCUIT_FAIL_THRESHOLD) {
        this.circuitOpenUntil.set(name, Date.now() + CIRCUIT_OPEN_TTL_MS);
        this.emitter.emit("tool_circuit_open", { name, remainMs: CIRCUIT_OPEN_TTL_MS });
      }
      return result;
    } finally {
      // Always release locks, even on error or rejection
      if (resourceIds.length > 0 && this.orchestrator) {
        this.orchestrator.locks.releaseAll(resourceIds, this.taskId ?? "root");
      }
    }
  }

  private requestApproval(
    callId: string,
    name: string,
    args: Record<string, unknown>
  ): Promise<ApprovalDecision> {
    const ttl = this.approvalTimeoutMs;
    return new Promise((resolve) => {
      const milestoneTimers: ReturnType<typeof setTimeout>[] = [];

      // Emit waiting milestones so UIs can show escalating urgency.
      for (const ms of [10_000, 30_000, 50_000]) {
        if (ms < ttl) {
          milestoneTimers.push(
            setTimeout(() => {
              this.emitter.emit("approval_waiting", { callId, name, elapsedMs: ms, totalMs: ttl });
            }, ms)
          );
        }
      }

      const clearMilestones = () => milestoneTimers.forEach(clearTimeout);

      const autoRejectTimer = setTimeout(() => {
        clearMilestones();
        resolve({
          decision: "reject",
          reason: `Approval timed out after ${Math.round(ttl / 1000)} seconds (no response)`,
        });
      }, ttl);
      this.emitter.emit("tool_approval", {
        callId,
        name,
        args,
        approvalTimeoutMs: ttl,
        resolve: (d) => {
          clearTimeout(autoRejectTimer);
          clearMilestones();
          resolve(d);
        },
      });
    });
  }
}
