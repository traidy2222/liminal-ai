import { AgentHarness } from "@liminal/core";
import { registerAllTools, INCEPTION_MESSAGES } from "@liminal/tools";
import type { SSEManager } from "./sse.js";
import type { ApprovalDecision } from "@liminal/core";

/** Wall-clock cap for one user message. Env: AGENT_SEND_TIMEOUT_MS (ms), clamped 60s–60m. */
function resolveSendTimeoutMs(): number {
  const raw = process.env["AGENT_SEND_TIMEOUT_MS"];
  if (raw === undefined || raw.trim() === "") return 600_000;
  const n = parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return 600_000;
  return Math.max(60_000, Math.min(n, 3_600_000));
}

export class AgentBridge {
  readonly harness: AgentHarness;
  private pendingApprovals = new Map<string, (d: ApprovalDecision) => void>();
  private pendingAskUser: ((answer: string) => void) | null = null;

  constructor(private readonly sse: SSEManager) {
    this.harness = new AgentHarness({
      openRouterApiKey: process.env["OPENROUTER_API_KEY"] ?? "",
      model: "openrouter/owl-alpha",
      baseURL: "https://openrouter.ai/api/v1",
      maxToolRoundsPerTurn: 128,
      sendTimeoutMs: resolveSendTimeoutMs(),
      // World context: auto-gather date/time/OS/shell; optionally include location
      // Set AGENT_LOCATION="City, Country" in .env to include physical location
      worldContext: process.env["AGENT_LOCATION"]
        ? { location: process.env["AGENT_LOCATION"] }
        : undefined,
      context: {
        modelMaxTokens: 128_000,
        thresholdFraction: 0.8,
        inceptionMessages: INCEPTION_MESSAGES,
      },
    });

    registerAllTools(this.harness.registry, this.harness.emitter, this.harness);
    this.wireEvents();
  }

  private wireEvents(): void {
    const { emitter } = this.harness;

    emitter.on("text", (p) => this.sse.send("text", p));
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

    emitter.on("tool_approval", (payload) => {
      this.pendingApprovals.set(payload.callId, payload.resolve);
      this.sse.send("tool_approval", {
        callId: payload.callId,
        name: payload.name,
        args: payload.args,
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
}
