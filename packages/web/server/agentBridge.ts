import {
  AgentHarness,
  maybeAttachSessionEventLog,
  resolveProviderConfig,
  resolveWorkspaceRoot,
  saveRuntimePreferences,
  resolveHarnessEnvRaw,
  type PersonaBootstrapProgressEvent,
} from "@liminal/core";
import {
  registerAllTools,
  INCEPTION_MESSAGES,
  buildProtocolDynamicSuffix,
  applyPersonaProfileToHarness,
  clearPersistedPersonaArtifacts,
  parsePersonaInput,
  generatePersonaFromInput,
  isResetToDefaultRequest,
} from "@liminal/tools";
import type { SSEManager } from "./sse.js";
import type { ApprovalDecision } from "@liminal/core";
import type { RuntimePreferences } from "@liminal/core";

/** Cap tool_result bodies for SSE so the web client reducer does not freeze on huge JSON. */
const SSE_TOOL_RESULT_MAX_CHARS = 48_000;

function capSseToolOutput(text: string): string {
  if (text.length <= SSE_TOOL_RESULT_MAX_CHARS) return text;
  return (
    text.slice(0, SSE_TOOL_RESULT_MAX_CHARS) +
    `\n\n[SSE: output truncated after ${SSE_TOOL_RESULT_MAX_CHARS} characters for UI performance]`
  );
}

function resolveSafetyJudge(
  prefs: RuntimePreferences | null
):
  | { enabled: true; model?: string }
  | undefined {
  if (resolveHarnessEnvRaw("AGENT_SAFETY_JUDGE", prefs) !== "1") return undefined;
  const model = resolveHarnessEnvRaw("AGENT_SAFETY_JUDGE_MODEL", prefs)?.trim();
  return {
    enabled: true,
    ...(model ? { model } : {}),
  };
}

function resolveWorldContext(
  prefs: RuntimePreferences | null
):
  | { location: string; sessionMode?: "initializer" | "coding" }
  | { sessionMode: "initializer" | "coding" }
  | undefined {
  const loc = resolveHarnessEnvRaw("AGENT_LOCATION", prefs)?.trim();
  const modeRaw = resolveHarnessEnvRaw("AGENT_SESSION_MODE", prefs)?.trim().toLowerCase();
  const sessionMode =
    modeRaw === "initializer" || modeRaw === "coding" ? modeRaw : undefined;
  if (!loc && !sessionMode) return undefined;
  if (loc && sessionMode) return { location: loc, sessionMode };
  if (loc) return { location: loc };
  return { sessionMode: sessionMode! };
}

export class AgentBridge {
  readonly harness: AgentHarness;
  /** Resolves after `registerAllTools` completes. */
  private readonly toolsRegistered: Promise<void>;
  /** Resolves after `beginSession` (persisted persona, bootstrap gate, optional greeting). */
  private readonly sessionReady: Promise<void>;
  /** No-op until maybeAttachSessionEventLog runs in constructor. */
  private detachSessionLog: () => void = () => {};
  private pendingApprovals = new Map<string, (d: ApprovalDecision) => void>();
  private pendingAskUser: ((answer: string) => void) | null = null;
  private harnessHeartbeatTimer: NodeJS.Timeout | null = null;
  private turnStartedAt: number | null = null;
  private awaitingPersonaBootstrapInput = false;
  private bootstrapInFlight = false;
  /** Wall-clock ms when the harness last emitted `turn_end` (for client status reconciliation). */
  private lastTurnEndedAtMs: number | null = null;
  private emitBootstrapProgress(
    stageOrEvent: string | PersonaBootstrapProgressEvent,
    message?: string
  ): void {
    const payload: PersonaBootstrapProgressEvent =
      typeof stageOrEvent === "string"
        ? { stage: stageOrEvent, message: message ?? "", at: Date.now() }
        : stageOrEvent;
    this.sse.send("persona_bootstrap_progress", payload);
  }

  constructor(private readonly sse: SSEManager, runtimePreferences: RuntimePreferences | null = null) {
    const provider = resolveProviderConfig(runtimePreferences?.provider);
    this.harness = new AgentHarness({
      openRouterApiKey: provider.apiKey,
      model: provider.model,
      baseURL: provider.baseURL,
      maxToolRoundsPerTurn: 128,
      safetyJudge: resolveSafetyJudge(runtimePreferences),
      workingStateEnabled: true,
      // World context: auto-gather date/time/OS/shell; optionally include location
      // Set AGENT_LOCATION="City, Country" in .env to include physical location
      worldContext: resolveWorldContext(runtimePreferences),
      runtimePreferences,
      persistRuntimePreferences: async (prefs) =>
        saveRuntimePreferences(prefs, resolveWorkspaceRoot()),
      context: {
        modelMaxTokens: 128_000,
        thresholdFraction: 0.6,
        inceptionMessages: INCEPTION_MESSAGES,
        protocolDynamicBuilder: (names, hint) => buildProtocolDynamicSuffix(names, (hint ?? "any") as import("@liminal/tools").ProtocolIntentHint),
      },
    });

    const harness = this.harness;
    this.detachSessionLog = maybeAttachSessionEventLog(harness.emitter, harness.taskId);
    this.wireEvents();
    this.toolsRegistered = registerAllTools(harness.registry, harness.emitter, harness);
    this.sessionReady = this.toolsRegistered.then(() => this.beginSession());
  }

  /** Wait until the tool registry is populated (before binding HTTP in dev, avoid races on /api/message). */
  whenToolsRegistered(): Promise<void> {
    return this.toolsRegistered;
  }

  /** Wait until tools are registered and opening session (bootstrap vs greeting) has settled. */
  whenSessionReady(): Promise<void> {
    return this.sessionReady;
  }

  /**
   * Apply persisted persona and bootstrap gate. Web defers the opening greet to the
   * client (`POST /api/session/reset` with `greet: true` on fresh page load) so reload
   * does not double-greet with server boot.
   */
  private async beginSession(options?: { greet?: boolean }): Promise<void> {
    const persisted = this.harness.getPersistedPersonaProfile();
    if (persisted) {
      await applyPersonaProfileToHarness(this.harness, persisted);
    }
    const forceBootstrap = process.env["AGENT_PERSONA_BOOTSTRAP_FORCE"] === "1";
    this.awaitingPersonaBootstrapInput = false;
    if (
      process.env["AGENT_PERSONA_BOOTSTRAP"] !== "0" &&
      (forceBootstrap || !this.harness.isPersonaBootstrapCompleted())
    ) {
      this.awaitingPersonaBootstrapInput = true;
      // Web uses a dedicated client modal for bootstrap input; do not spend a model turn
      // by asking in chat here.
      return;
    }
    if (options?.greet !== true) return;
    try {
      await this.harness.sendSessionGreeting();
    } catch (err) {
      console.error(
        "Session greeting failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  private startHeartbeat(): void {
    if (this.harnessHeartbeatTimer) return;
    if (!this.turnStartedAt) this.turnStartedAt = Date.now();
    const tick = (): void => {
      if (!this.harness.getIsRunning()) {
        this.stopHeartbeat();
        return;
      }
      this.sse.send("harness_running", { startedAt: this.turnStartedAt });
    };
    tick();
    this.harnessHeartbeatTimer = setInterval(tick, 5_000);
  }

  private stopHeartbeat(): void {
    if (this.harnessHeartbeatTimer) { clearInterval(this.harnessHeartbeatTimer); this.harnessHeartbeatTimer = null; }
    this.turnStartedAt = null;
  }

  /** Current busy state — exposed for /api/status. */
  get isBusy(): boolean { return this.harness.getIsRunning(); }
  get turnStartTime(): number | null { return this.turnStartedAt; }
  get lastTurnEndedAt(): number | null {
    return this.lastTurnEndedAtMs;
  }
  get isAwaitingPersonaBootstrap(): boolean { return this.awaitingPersonaBootstrapInput; }

  private wireEvents(): void {
    const { emitter } = this.harness;

    emitter.on("text", (p) => { this.startHeartbeat(); this.sse.send("text", p); });
    emitter.on("provider_retry", (p) => { this.startHeartbeat(); this.sse.send("provider_retry", p); });
    emitter.on("tool_start", (p) => { this.startHeartbeat(); this.sse.send("tool_start", p); });
    emitter.on("tool_delta", (p) => this.sse.send("tool_delta", p));
    emitter.on("tool_result", (p) =>
      this.sse.send("tool_result", {
        callId: p.callId,
        name: p.name,
        args: p.args,
        ok: p.result.ok,
        output: capSseToolOutput(p.result.ok ? p.result.output : p.result.error),
      })
    );
    emitter.on("turn_summary", (p) => this.sse.send("turn_summary", p));
    emitter.on("turn_end", (p) => {
      this.lastTurnEndedAtMs = Date.now();
      this.stopHeartbeat();
      this.sse.send("turn_end", p);
    });
    emitter.on("error", (p) => { this.stopHeartbeat(); this.sse.send("error", { message: p.err.message }); });

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
    emitter.on("auto_dream", (p) => this.sse.send("auto_dream", p));
    emitter.on("heartbeat_scheduled", (p) => this.sse.send("heartbeat_scheduled", p));
    emitter.on("heartbeat_started", (p) => this.sse.send("heartbeat_started", p));
    emitter.on("heartbeat_completed", (p) => this.sse.send("heartbeat_completed", p));
    emitter.on("heartbeat_skipped", (p) => this.sse.send("heartbeat_skipped", p));

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
  clearSession(options?: { preserveBootstrapState?: boolean }): void {
    this.harness.clearConversation();
    if (!options?.preserveBootstrapState) {
      this.awaitingPersonaBootstrapInput = false;
    }
    this.bootstrapInFlight = false;
  }

  /** Called after reset to run bootstrap/greeting sequence again. */
  async initializeSessionAfterReset(): Promise<void> {
    await this.beginSession({ greet: true });
  }

  async sendUserMessage(message: string, opts?: { freshContext?: boolean }): Promise<void> {
    if (!this.awaitingPersonaBootstrapInput) {
      const run = this.harness.send(message, opts);
      this.startHeartbeat();
      await run;
      return;
    }
    throw new Error("Persona bootstrap is pending. Submit via /api/persona/bootstrap.");
  }

  async submitPersonaBootstrap(input: string, options?: { skip?: boolean }): Promise<void> {
    if (!this.awaitingPersonaBootstrapInput) {
      throw new Error("Persona bootstrap is not pending (already completed or not enabled). Refresh the page.");
    }
    if (this.harness.getIsRunning()) {
      throw new Error("Session is still initializing. Please retry persona bootstrap in a moment.");
    }
    if (this.bootstrapInFlight) {
      throw new Error("Persona bootstrap is already in progress.");
    }
    this.bootstrapInFlight = true;
    this.emitBootstrapProgress("starting", "Bootstrap started. Validating input...");
    try {
      const trimmed = input.trim();
      const skipAllowed = process.env["AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP"] !== "0";
      if (options?.skip || (skipAllowed && /^(skip|\/skip)$/i.test(trimmed))) {
        this.emitBootstrapProgress("skip", "Skipping persona generation. Restoring default voice...");
        this.awaitingPersonaBootstrapInput = false;
        await clearPersistedPersonaArtifacts().catch(() => undefined);
        // Persist first-run as dismissed so bootstrap modal does not return on next launch.
        await this.harness.patchRuntimePreferences(
          {
            persona: {
              bootstrapCompleted: true,
              sourcePrompt: "",
              activeProfile: null,
              updatedAt: Date.now(),
            },
          },
          { persist: true }
        );
        await this.harness.sendSessionGreeting();
        this.emitBootstrapProgress("done", "Session ready.");
        return;
      }

      const parsed = parsePersonaInput(trimmed);
      if (!parsed.coreInput) {
        throw new Error("Please describe the voice you want before continuing.");
      }
      this.emitBootstrapProgress("parsed", "Input parsed. Building persona profile...");

      if (isResetToDefaultRequest(parsed.coreInput)) {
        this.emitBootstrapProgress("reset", "Resetting to default persona...");
        this.harness.resetPersona();
        await clearPersistedPersonaArtifacts().catch(() => undefined);
        await this.harness.patchRuntimePreferences(
          {
            persona: {
              bootstrapCompleted: true,
              sourcePrompt: "default",
              activeProfile: null,
              updatedAt: Date.now(),
            },
          },
          { persist: true }
        );
        this.awaitingPersonaBootstrapInput = false;
        await this.harness.sendSessionGreeting();
        this.emitBootstrapProgress("done", "Session ready.");
        return;
      }

      this.emitBootstrapProgress(
        "generating",
        "Generating persona profile and soul blueprint…"
      );
      const bundle = await generatePersonaFromInput(
        this.harness,
        parsed.coreInput,
        parsed.strength,
        parsed.modifier,
        (stage, message, detail) =>
          this.emitBootstrapProgress({
            stage,
            message,
            at: Date.now(),
            artifacts: detail?.artifacts,
          })
      );
      const profile = bundle.profile;
      this.emitBootstrapProgress("applying", "Applying persona context to the runtime...");
      try {
        await applyPersonaProfileToHarness(this.harness, profile);
        this.emitBootstrapProgress("persisting", "Persisting persona profile and bootstrap state...");
        await this.harness.patchRuntimePreferences(
          {
            persona: {
              bootstrapCompleted: true,
              sourcePrompt: parsed.coreInput,
              activeProfile: profile,
              controls: bundle.defaultControls,
              updatedAt: Date.now(),
            },
          },
          { persist: true }
        );
      } catch (applyErr) {
        // Rollback: reset persona to default so the harness is not left in a partial state.
        this.harness.resetPersona();
        throw applyErr;
      }
      this.awaitingPersonaBootstrapInput = false;
      this.emitBootstrapProgress("greeting", "Finalizing session greeting...");
      await this.harness.sendSessionGreeting();
      this.emitBootstrapProgress("done", "Bootstrap complete.");
    } finally {
      this.bootstrapInFlight = false;
    }
  }

}
