import { randomBytes } from "node:crypto";
import {
  AgentHarness,
  maybeAttachSessionEventLog,
  resolveProviderConfigWithInference,
  type ProviderConfig,
  resolveWorkspaceRoot,
  runWithWorkspaceRoot,
  saveRuntimePreferences,
  resolveHarnessEnvRaw,
  touchChatMetadata,
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

/** Per-bridge configuration. Each chat = one AgentBridge with its own workspace + harness. */
export interface AgentBridgeOptions {
  /** Chat / harness taskId. Stable across bridge restarts for the same chat. */
  chatId: string;
  /**
   * Absolute workspace root the harness operates in. All workspace-rooted reads/writes
   * (file tools, git, repo_map, world_context) happen inside `runWithWorkspaceRoot(this)`
   * scopes so concurrent chats with different workspaces stay isolated.
   */
  workspaceRoot: string;
}

export class AgentBridge {
  readonly chatId: string;
  readonly workspaceRoot: string;
  readonly harness: AgentHarness;
  /** Resolves after `registerAllTools` completes. */
  private readonly toolsRegistered: Promise<void>;
  /** Resolves after `beginSession` (persisted persona, bootstrap gate, optional greeting). */
  private readonly sessionReady: Promise<void>;
  /** No-op until maybeAttachSessionEventLog runs in constructor. */
  private detachSessionLog: () => void = () => {};
  private pendingApprovals = new Map<
    string,
    { resolve: (d: ApprovalDecision) => void; nonce: string }
  >();
  private pendingAskUser: ((answer: string) => void) | null = null;
  private harnessHeartbeatTimer: NodeJS.Timeout | null = null;
  private turnStartedAt: number | null = null;
  private awaitingPersonaBootstrapInput = false;
  private bootstrapInFlight = false;
  /** Wall-clock ms when the harness last emitted `turn_end` (for client status reconciliation). */
  private lastTurnEndedAtMs: number | null = null;
  /**
   * When suspended, SSE forwarding is silent — used while another chat is the
   * active one in the ChatManager so background harnesses don't bleed events
   * into the UI of an unrelated chat.
   */
  private sseSuspended = true;
  /** Detach functions for all emitter subscriptions, so dispose() can fully unwire. */
  private emitterDetachers: Array<() => void> = [];

  private emitBootstrapProgress(
    stageOrEvent: string | PersonaBootstrapProgressEvent,
    message?: string
  ): void {
    const payload: PersonaBootstrapProgressEvent =
      typeof stageOrEvent === "string"
        ? { stage: stageOrEvent, message: message ?? "", at: Date.now() }
        : stageOrEvent;
    this.maybeSend("persona_bootstrap_progress", payload);
  }

  constructor(
    private readonly sse: SSEManager,
    options: AgentBridgeOptions,
    runtimePreferences: RuntimePreferences | null = null,
    providerConfig?: ProviderConfig
  ) {
    this.chatId = options.chatId;
    this.workspaceRoot = options.workspaceRoot;
    const provider =
      providerConfig ??
      (() => {
        throw new Error(
          "AgentBridge requires a pre-resolved provider; call resolveProviderConfigWithInference before construction."
        );
      })();
    // All harness construction work happens inside the chat's workspace scope
    // so world-context gather, persona discovery, etc. resolve relative to this
    // chat's bound folder rather than the server's cwd.
    this.harness = runWithWorkspaceRoot(this.workspaceRoot, () =>
      new AgentHarness({
        openRouterApiKey: provider.apiKey,
        model: provider.model,
        baseURL: provider.baseURL,
        // Use the chatId as the harness taskId so session.jsonl, write_staging,
        // and meta.json all share a directory under ~/.liminal/chats/<chatId>/.
        taskId: this.chatId,
        // Per-harness workspace root — AgentHarness wraps its own send() in an
        // AsyncLocalStorage scope so file/git/repo_map tools resolve relative
        // to this chat's folder even when multiple chats coexist in process.
        workspaceRoot: this.workspaceRoot,
        maxToolRoundsPerTurn: 128,
        safetyJudge: resolveSafetyJudge(runtimePreferences),
        workingStateEnabled: true,
        worldContext: resolveWorldContext(runtimePreferences),
        runtimePreferences,
        persistRuntimePreferences: async (prefs) =>
          // Runtime prefs are user-global (Phase 1) — passing the chat's
          // workspaceRoot still works because the global path resolver wins
          // when the storage split is active.
          saveRuntimePreferences(prefs, this.workspaceRoot),
        context: {
          modelMaxTokens: 128_000,
          thresholdFraction: 0.6,
          inceptionMessages: INCEPTION_MESSAGES,
          protocolDynamicBuilder: (names, hint) =>
            buildProtocolDynamicSuffix(names, (hint ?? "any") as import("@liminal/tools").ProtocolIntentHint),
        },
      })
    );

    const harness = this.harness;
    this.detachSessionLog = maybeAttachSessionEventLog(harness.emitter, harness.taskId);
    this.wireEvents();
    this.toolsRegistered = runWithWorkspaceRoot(this.workspaceRoot, async () => {
      registerAllTools(harness.registry, harness.emitter, harness);
      const { wireEnterpriseWithInstall } = await import("@liminal/core");
      const ee = await wireEnterpriseWithInstall({
        registry: harness.registry,
        emitter: harness.emitter,
        harness,
      });
      if (!ee.wired && ee.reason) {
        console.warn("[enterprise] feature wiring skipped:", ee.reason);
      }
    });
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
   * Activate this bridge as the live SSE source. Called by ChatManager when the
   * user switches to this chat. Also touches chat metadata so the list-sort
   * reflects most-recent-active first.
   */
  async resumeSSE(): Promise<void> {
    this.sseSuspended = false;
    await touchChatMetadata(this.chatId).catch(() => undefined);
    // If the harness is mid-turn at activation, surface a fresh heartbeat so
    // the client UI immediately sees the busy state.
    if (this.harness.getIsRunning()) {
      this.sse.send(
        "harness_running",
        {
          startedAt: this.turnStartedAt ?? Date.now(),
        },
        this.chatId
      );
    }
  }

  /** Silence SSE forwarding (used while another chat is the active one). */
  suspendSSE(): void {
    this.sseSuspended = true;
  }

  /** Gated send — short-circuits when this bridge is not the active SSE source. */
  private maybeSend(event: string, payload: unknown): void {
    if (this.sseSuspended) return;
    this.sse.send(event, payload, this.chatId);
  }

  /**
   * Apply persisted persona and bootstrap gate. Web defers the opening greet to the
   * client (`POST /api/session/reset` with `greet: true` on fresh page load) so reload
   * does not double-greet with server boot.
   */
  private async beginSession(options?: { greet?: boolean }): Promise<void> {
    return runWithWorkspaceRoot(this.workspaceRoot, async () => {
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
        // Surface busy state immediately — `running` is set synchronously inside
        // send(), so starting the heartbeat now emits harness_running before the
        // first model token (mirrors sendUserMessage). Without this the greeting
        // turn runs with no "PROCESSING" indicator until the first text event.
        const run = this.harness.sendSessionGreeting();
        this.startHeartbeat();
        await run;
      } catch (err) {
        console.error(
          "Session greeting failed:",
          err instanceof Error ? err.message : String(err)
        );
      }
    });
  }

  /** Kick off the opening greeting non-blocking, surfacing busy state immediately. */
  beginGreeting(): void {
    void runWithWorkspaceRoot(this.workspaceRoot, async () => {
      const run = this.harness.sendSessionGreeting();
      this.startHeartbeat();
      await run;
    }).catch((err) => {
      this.maybeSend("error", {
        message: err instanceof Error ? err.message : "Session greeting failed.",
      });
    });
  }

  private startHeartbeat(): void {
    if (this.harnessHeartbeatTimer) return;
    if (!this.turnStartedAt) this.turnStartedAt = Date.now();
    const tick = (): void => {
      if (!this.harness.getIsRunning()) {
        this.stopHeartbeat();
        return;
      }
      this.maybeSend("harness_running", { startedAt: this.turnStartedAt });
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
  get isActive(): boolean { return !this.sseSuspended; }

  private wireEvents(): void {
    const { emitter } = this.harness;

    // Track every subscription so dispose() can fully detach.
    const on = <K extends Parameters<typeof emitter.on>[0]>(
      event: K,
      handler: Parameters<typeof emitter.on<K>>[1]
    ): void => {
      emitter.on(event, handler);
      this.emitterDetachers.push(() => emitter.off(event, handler));
    };

    on("text", (p) => { this.startHeartbeat(); this.maybeSend("text", p); });
    on("provider_retry", (p) => { this.startHeartbeat(); this.maybeSend("provider_retry", p); });
    on("tool_start", (p) => { this.startHeartbeat(); this.maybeSend("tool_start", p); });
    on("speech", (p) => this.maybeSend("speech", p));
    on("tool_delta", (p) => this.maybeSend("tool_delta", p));
    on("tool_result", (p) =>
      this.maybeSend("tool_result", {
        callId: p.callId,
        name: p.name,
        args: p.args,
        ok: p.result.ok,
        output: capSseToolOutput(p.result.ok ? p.result.output : p.result.error),
      })
    );
    on("turn_summary", (p) => this.maybeSend("turn_summary", p));
    on("turn_end", (p) => {
      this.lastTurnEndedAtMs = Date.now();
      this.stopHeartbeat();
      this.maybeSend("turn_end", p);
    });
    on("error", (p) => { this.stopHeartbeat(); this.maybeSend("error", { message: p.err.message }); });

    on("subtask_spawned", (p) => this.maybeSend("subtask_spawned", p));
    on("subtask_complete", (p) => this.maybeSend("subtask_complete", p));
    on("subtask_output", (p) => this.maybeSend("subtask_output", p));
    on("subtask_trace", (p) => this.maybeSend("subtask_trace", p));
    on("subtask_tool_start", (p) => this.maybeSend("subtask_tool_start", p));
    on("subtask_tool_result", (p) => this.maybeSend("subtask_tool_result", p));

    on("ask_user_answered", (p) => this.maybeSend("ask_user_answered", p));
    on("approval_decision", (p) => this.maybeSend("approval_decision", p));
    on("context_compressed", (p) => this.maybeSend("context_compressed", p));
    on("tool_timing", (p) => this.maybeSend("tool_timing", p));
    on("persona_changed", (p) => this.maybeSend("persona_changed", p));
    on("execution_state", (p) => this.maybeSend("execution_state", p));
    on("contract_transition", (p) => this.maybeSend("contract_transition", p));
    on("contract_violation", (p) => this.maybeSend("contract_violation", p));
    on("recovery_action", (p) => this.maybeSend("recovery_action", p));
    on("drift_detected", (p) => this.maybeSend("drift_detected", p));
    on("runtime_heartbeat", (p) => this.maybeSend("runtime_heartbeat", p));
    on("vault_activity", (p) => this.maybeSend("vault_activity", p));
    on("runtime_pref_detected", (p) => this.maybeSend("runtime_pref_detected", p));
    on("runtime_pref_changed", (p) => this.maybeSend("runtime_pref_changed", p));
    on("runtime_pref_persisted", (p) => this.maybeSend("runtime_pref_persisted", p));
    on("runtime_pref_rejected", (p) => this.maybeSend("runtime_pref_rejected", p));
    on("auto_dream", (p) => this.maybeSend("auto_dream", p));
    on("heartbeat_scheduled", (p) => this.maybeSend("heartbeat_scheduled", p));
    on("heartbeat_started", (p) => this.maybeSend("heartbeat_started", p));
    on("heartbeat_completed", (p) => this.maybeSend("heartbeat_completed", p));
    on("heartbeat_skipped", (p) => this.maybeSend("heartbeat_skipped", p));

    on("tool_approval", (payload) => {
      const nonce = randomBytes(16).toString("hex");
      this.pendingApprovals.set(payload.callId, { resolve: payload.resolve, nonce });
      this.maybeSend("tool_approval", {
        callId: payload.callId,
        name: payload.name,
        args: payload.args,
        approvalTimeoutMs: payload.approvalTimeoutMs,
        approvalNonce: nonce,
      });
    });

    on("ask_user", (payload) => {
      this.pendingAskUser = payload.resolve;
      this.maybeSend("ask_user", { prompt: payload.prompt });
    });
  }

  resolveApproval(callId: string, decision: ApprovalDecision, approvalNonce: string): boolean {
    const pending = this.pendingApprovals.get(callId);
    if (!pending || pending.nonce !== approvalNonce) return false;
    pending.resolve(decision);
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

  async sendUserMessage(
    message: string,
    opts?: { freshContext?: boolean; liveDictation?: boolean }
  ): Promise<void> {
    if (this.awaitingPersonaBootstrapInput) {
      throw new Error("Persona bootstrap is pending. Submit via /api/persona/bootstrap.");
    }
    // Pin the workspace for the whole send so file tools, repo_map, world_context,
    // etc. resolve relative to this chat's bound folder rather than the server's cwd.
    await runWithWorkspaceRoot(this.workspaceRoot, async () => {
      const run = this.harness.send(message, {
        freshContext: opts?.freshContext,
        liveDictation: opts?.liveDictation,
      });
      this.startHeartbeat();
      await run;
    });
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
      await runWithWorkspaceRoot(this.workspaceRoot, async () => {
        const trimmed = input.trim();
        const skipAllowed = process.env["AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP"] !== "0";
        if (options?.skip || (skipAllowed && /^(skip|\/skip)$/i.test(trimmed))) {
          this.emitBootstrapProgress("skip", "Skipping persona generation. Restoring default voice...");
          this.awaitingPersonaBootstrapInput = false;
          await clearPersistedPersonaArtifacts().catch(() => undefined);
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
          this.harness.resetPersona();
          throw applyErr;
        }
        this.awaitingPersonaBootstrapInput = false;
        this.emitBootstrapProgress("greeting", "Finalizing session greeting...");
        await this.harness.sendSessionGreeting();
        this.emitBootstrapProgress("done", "Bootstrap complete.");
      });
    } finally {
      this.bootstrapInFlight = false;
    }
  }

  /** Re-resolve API provider after Vireon sign-in (managed inference / license). */
  async reapplyProvider(runtimePreferences: RuntimePreferences | null): Promise<void> {
    if (this.harness.getIsRunning()) {
      throw new Error("Agent is busy; finish the current turn before reconnecting.");
    }
    await this.harness.refreshProviderConfig();
    void runtimePreferences;
  }

  /**
   * Full teardown for permanent disposal (chat deleted). Detaches emitter
   * subscriptions, session log writer, and clears any in-flight approval
   * promises so the harness can be garbage-collected.
   */
  dispose(): void {
    try {
      this.stopHeartbeat();
      this.detachSessionLog();
      for (const off of this.emitterDetachers) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
      this.emitterDetachers = [];
      // Reject any pending approvals so the harness send() unwinds cleanly.
      for (const [, pending] of this.pendingApprovals) {
        try {
          pending.resolve({ decision: "reject", reason: "chat_disposed" });
        } catch {
          /* ignore */
        }
      }
      this.pendingApprovals.clear();
      if (this.pendingAskUser) {
        try {
          this.pendingAskUser("");
        } catch {
          /* ignore */
        }
        this.pendingAskUser = null;
      }
    } catch (err) {
      console.error("[bridge.dispose]", err);
    }
  }
}
