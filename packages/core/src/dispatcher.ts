import type { ToolResult, ToolParameterSchema, PropertySchema, ApprovalDecision } from "./types.js";
import type { AgentEmitter } from "./events.js";
import type { ToolRegistry } from "./registry.js";
import type { TaskOrchestrator } from "./orchestrator.js";
import { guardToolArgs } from "./tool_arg_guard.js";

// ─── Schema validation (#5 — Tool Invocation Reliability arXiv:2601.16280) ────

/**
 * Recursively validate a single value against a PropertySchema.
 * Checks: type, enum, numeric range, string length, array items, nested objects.
 */
function validateValue(key: string, val: unknown, schema: PropertySchema): string | null {
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

export class ToolDispatcher {
  /**
   * Per-dispatcher result cache for cacheable tools (#6 — Tool Cache Agent).
   * Keyed by `${toolName}:${argsJson}`, value includes result + expiry timestamp.
   */
  private readonly resultCache = new Map<string, { result: ToolResult; expiresAt: number }>();

  /**
   * True if think() was called in the most recently completed round.
   * Allows the NEXT round's destructive tools to pass the pre-flight check —
   * models naturally call think() alone, then act in the following round.
   */
  private lastBatchHadThink = false;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly emitter: AgentEmitter,
    private readonly orchestrator?: TaskOrchestrator,
    private readonly taskId?: string
  ) {}

  /**
   * Called by AgentHarness after each batch of tool calls completes.
   * Tracks whether think() appeared so the next round's pre-flight can see it.
   */
  notifyBatchComplete(batchToolNames: string[]): void {
    this.lastBatchHadThink = batchToolNames.includes("think");
  }

  /**
   * Call a tool directly, bypassing approval/locking/events.
   * Used internally by the harness for housekeeping (reflexion, recipes).
   */
  async directCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const tool = this.registry.get(name);
    if (!tool) return { ok: false, error: `Unknown tool: "${name}"` };
    const guardMsg = guardToolArgs(name, args);
    if (guardMsg) return { ok: false, error: `[ARG GUARD] ${guardMsg}` };
    try {
      return await tool.handler(args);
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
    const tool = this.registry.get(name);
    if (!tool) {
      return { ok: false, error: `Unknown tool: "${name}"` };
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

    // Schema validation before execution (#5 deep validation)
    const validationError = validateArgs(tool.parameters, args);
    if (validationError) {
      const result: ToolResult = {
        ok: false,
        error: `Invalid args for "${name}": ${validationError}`,
      };
      this.emitter.emit("tool_result", { callId, name, args, result });
      return result;
    }

    const guardMsg = guardToolArgs(name, args);
    if (guardMsg) {
      const result: ToolResult = { ok: false, error: `[ARG GUARD] ${guardMsg}` };
      this.emitter.emit("tool_result", { callId, name, args, result });
      return result;
    }

    // Result cache lookup (#6 — Tool Cache Agent, 1.69× speedup)
    if (tool.cacheable) {
      const cacheKey = `${name}:${argsJson}`;
      const cached = this.resultCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        this.emitter.emit("tool_result", { callId, name, args, result: cached.result });
        return cached.result;
      }
    }

    // Pre-flight: destructive tools require think() in the same round OR the immediately
    // preceding round. Models commonly call think() alone, then act in the next round.
    if (tool.dangerLevel === "destructive") {
      const hasThink =
        (batchToolNames?.includes("think") ?? false) || this.lastBatchHadThink;
      if (!hasThink) {
        const result: ToolResult = {
          ok: false,
          error:
            `Destructive tool "${name}" blocked: you must call think() in the same round first ` +
            `to reason about what this command will do and confirm it is correct.`,
        };
        this.emitter.emit("tool_result", { callId, name, args, result });
        return result;
      }
    }

    // Acquire resource locks if declared
    const resourceIds = tool.resourceLocks?.(args) ?? [];
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
        this.emitter.emit("tool_result", { callId, name, args, result });
        return result;
      }
    }

    try {
      if (tool.requiresApproval) {
        const decision = await this.requestApproval(callId, name, args);
        // Emit approval decision for audit trail (#7 Structured Event Log)
        this.emitter.emit("approval_decision", {
          callId,
          name,
          decision: decision.decision,
          ...(decision.decision === "edit" && { editedArgs: decision.editedArgs }),
        });
        if (decision.decision === "reject") {
          const result: ToolResult = {
            ok: false,
            error: `Tool "${name}" rejected by user: ${decision.reason}`,
          };
          this.emitter.emit("tool_result", { callId, name, args, result });
          return result;
        }
        if (decision.decision === "edit") {
          args = decision.editedArgs;
        }
      }

      // Tool timing instrumentation (#7 Structured Event Log — AgentTrace arXiv:2602.10133)
      const t0 = Date.now();
      const result = await tool.handler(args);
      this.emitter.emit("tool_timing", { callId, name, durationMs: Date.now() - t0 });

      // Store successful result in cache if cacheable (#6)
      if (tool.cacheable && result.ok) {
        const cacheKey = `${name}:${argsJson}`;
        const ttl = tool.cacheTtlMs ?? 30_000;
        this.resultCache.set(cacheKey, { result, expiresAt: Date.now() + ttl });
      }

      this.emitter.emit("tool_result", { callId, name, args, result });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const result: ToolResult = { ok: false, error };
      this.emitter.emit("tool_result", { callId, name, args, result });
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
    return new Promise((resolve) => {
      // Auto-reject if no human responds within 60 seconds
      const autoRejectTimer = setTimeout(() => {
        resolve({ decision: "reject", reason: "Approval timed out after 60 seconds (no response)" });
      }, 60_000);
      this.emitter.emit("tool_approval", {
        callId,
        name,
        args,
        resolve: (d) => {
          clearTimeout(autoRejectTimer);
          resolve(d);
        },
      });
    });
  }
}
