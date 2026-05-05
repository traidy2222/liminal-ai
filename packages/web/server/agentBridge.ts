import {
  AgentHarness,
  maybeAttachSessionEventLog,
  resolveProviderConfig,
  saveRuntimePreferences,
} from "@liminal/core";
import {
  registerAllTools,
  INCEPTION_MESSAGES,
  buildProtocolDynamicSuffix,
} from "@liminal/tools";
import type { SSEManager } from "./sse.js";
import type { ApprovalDecision } from "@liminal/core";
import type { RuntimePreferences } from "@liminal/core";

function resolveSafetyJudge():
  | { enabled: true; model?: string }
  | undefined {
  if (process.env["AGENT_SAFETY_JUDGE"] !== "1") return undefined;
  const model = process.env["AGENT_SAFETY_JUDGE_MODEL"]?.trim();
  return {
    enabled: true,
    ...(model ? { model } : {}),
  };
}

function resolveWorldContext():
  | { location: string; sessionMode?: "initializer" | "coding" }
  | { sessionMode: "initializer" | "coding" }
  | undefined {
  const loc = process.env["AGENT_LOCATION"]?.trim();
  const modeRaw = process.env["AGENT_SESSION_MODE"]?.trim().toLowerCase();
  const sessionMode =
    modeRaw === "initializer" || modeRaw === "coding" ? modeRaw : undefined;
  if (!loc && !sessionMode) return undefined;
  if (loc && sessionMode) return { location: loc, sessionMode };
  if (loc) return { location: loc };
  return { sessionMode: sessionMode! };
}

export class AgentBridge {
  readonly harness: AgentHarness;
  /** No-op until maybeAttachSessionEventLog runs in constructor. */
  private detachSessionLog: () => void = () => {};
  private pendingApprovals = new Map<string, (d: ApprovalDecision) => void>();
  private pendingAskUser: ((answer: string) => void) | null = null;

  constructor(private readonly sse: SSEManager, runtimePreferences: RuntimePreferences | null = null) {
    const provider = resolveProviderConfig(runtimePreferences?.provider);
    this.harness = new AgentHarness({
      openRouterApiKey: provider.apiKey,
      model: provider.model,
      baseURL: provider.baseURL,
      maxToolRoundsPerTurn: 128,
      safetyJudge: resolveSafetyJudge(),
      workingStateEnabled: true,
      // World context: auto-gather date/time/OS/shell; optionally include location
      // Set AGENT_LOCATION="City, Country" in .env to include physical location
      worldContext: resolveWorldContext(),
      runtimePreferences,
      persistRuntimePreferences: async (prefs) => saveRuntimePreferences(prefs),
      context: {
        modelMaxTokens: 128_000,
        thresholdFraction: 0.8,
        inceptionMessages: INCEPTION_MESSAGES,
        protocolDynamicBuilder: (names) => buildProtocolDynamicSuffix(names),
      },
    });

    registerAllTools(this.harness.registry, this.harness.emitter, this.harness);
    this.detachSessionLog = maybeAttachSessionEventLog(
      this.harness.emitter,
      this.harness.taskId
    );
    this.wireEvents();
  }

  private wireEvents(): void {
    const { emitter } = this.harness;

    emitter.on("text", (p) => this.sse.send("text", p));
    emitter.on("provider_retry", (p) => this.sse.send("provider_retry", p));
    emitter.on("tool_start", (p) => this.sse.send("tool_start", p));
    emitter.on("tool_delta", (p) => this.sse.send("tool_delta", p));
    emitter.on("tool_result", (p) =>
      this.sse.send("tool_result", {
        callId: p.callId,
        name: p.name,
        args: p.args,
        ok: p.result.ok,
        output: p.result.ok ? p.result.output : p.result.error,
      })
    );
    emitter.on("turn_end", (p) => this.sse.send("turn_end", p));
    emitter.on("error", (p) => this.sse.send("error", { message: p.err.message }));

    emitter.on("subtask_spawned", (p) => this.sse.send("subtask_spawned", p));
    emitter.on("subtask_complete", (p) => this.sse.send("subtask_complete", p));
    emitter.on("subtask_output", (p) => this.sse.send("subtask_output", p));

    // New structured telemetry events (#7 — AgentTrace arXiv:2602.10133)
    emitter.on("ask_user_answered", (p) => this.sse.send("ask_user_answered", p));
    emitter.on("approval_decision", (p) => this.sse.send("approval_decision", p));
    emitter.on("context_compressed", (p) => this.sse.send("context_compressed", p));
    emitter.on("tool_timing", (p) => this.sse.send("tool_timing", p));
    emitter.on("persona_changed", (p) => this.sse.send("persona_changed", p));
    emitter.on("execution_state", (p) => this.sse.send("execution_state", p));
    emitter.on("contract_transition", (p) => this.sse.send("contract_transition", p));
    emitter.on("contract_violation", (p) => this.sse.send("contract_violation", p));
    emitter.on("recovery_action", (p) => this.sse.send("recovery_action", p));
    emitter.on("drift_detected", (p) => this.sse.send("drift_detected", p));
    emitter.on("runtime_heartbeat", (p) => this.sse.send("runtime_heartbeat", p));
    emitter.on("vault_activity", (p) => this.sse.send("vault_activity", p));
    emitter.on("runtime_pref_detected", (p) => this.sse.send("runtime_pref_detected", p));
    emitter.on("runtime_pref_changed", (p) => this.sse.send("runtime_pref_changed", p));
    emitter.on("runtime_pref_persisted", (p) => this.sse.send("runtime_pref_persisted", p));
    emitter.on("runtime_pref_rejected", (p) => this.sse.send("runtime_pref_rejected", p));

    emitter.on("tool_approval", (payload) => {
      this.pendingApprovals.set(payload.callId, payload.resolve);
      this.sse.send("tool_approval", {
        callId: payload.callId,
        name: payload.name,
        args: payload.args,
        approvalTimeoutMs: payload.approvalTimeoutMs,
      });
    });

    emitter.on("ask_user", (payload) => {
      this.pendingAskUser = payload.resolve;
      this.sse.send("ask_user", { prompt: payload.prompt });
    });
  }

  resolveApproval(callId: string, decision: ApprovalDecision): boolean {
    const resolve = this.pendingApprovals.get(callId);
    if (!resolve) return false;
    resolve(decision);
    this.pendingApprovals.delete(callId);
    return true;
  }

  resolveAskUser(answer: string): boolean {
    if (!this.pendingAskUser) return false;
    this.pendingAskUser(answer);
    this.pendingAskUser = null;
    return true;
  }

  /** Clear transcript; next user message re-injects world context (root). */
  clearSession(): void {
    this.harness.clearConversation();
  }
}
