import { randomBytes } from "node:crypto";
import {
  type AgentHarness,
  type ApprovalDecision,
  type PersonaBootstrapProgressEvent,
  buildTranscriptReplayFromConversation,
  conversationEntriesForHydration,
  loadChatTranscriptFromSessionLog,
  runWithWorkspaceRoot,
  slimReplayEntriesForWire,
} from "@liminal/core";
import {
  applyPersonaProfileToHarness,
  clearPersistedPersonaArtifacts,
  resetPersonaBootstrapState,
  installDefaultPersonaArtifacts,
  generatePersonaFromInput,
  isResetToDefaultRequest,
  parsePersonaInput,
} from "@liminal/tools";
import {
  serverFrame,
  type ServerEventMap,
  type ServerEventType,
  type ServerFrame,
} from "@liminal/protocol";
import {
  wireAskUser,
  wireError,
  wireToolApproval,
  wireToolResult,
} from "./event_mapper.js";

/** Sink the bridge pushes outbound frames into (one per attached UI socket fan-out). */
export type FrameSink = (frame: ServerFrame) => void;

/**
 * Transport-agnostic wiring between one {@link AgentHarness} and the native UI.
 *
 * This is the sidecar's equivalent of the web `AgentBridge`, but it emits typed
 * protocol frames through a {@link FrameSink} instead of SSE. The harness, the
 * event vocabulary, and the approval/ask-user round-trip semantics are
 * identical — only the transport differs.
 */
export class SessionBridge {
  readonly chatId: string;
  readonly workspaceRoot: string;
  readonly harness: AgentHarness;
  private readonly sink: FrameSink;

  private pendingApprovals = new Map<
    string,
    { resolve: (d: ApprovalDecision) => void; nonce: string }
  >();
  private pendingAskUser: ((answer: string) => void) | null = null;
  private turnStartedAt: number | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private detachers: Array<() => void> = [];
  private awaitingPersonaBootstrapInput = false;
  private bootstrapInFlight = false;
  private transcriptHydrated = false;

  constructor(harness: AgentHarness, chatId: string, workspaceRoot: string, sink: FrameSink) {
    this.harness = harness;
    this.chatId = chatId;
    this.workspaceRoot = workspaceRoot;
    this.sink = sink;
    this.wireEvents();
  }

  /** Build + emit a server frame stamped with this chat's id. */
  private emit<K extends ServerEventType>(event: K, data: ServerEventMap[K]): void {
    this.sink(serverFrame(event, data, this.chatId));
  }

  get isBusy(): boolean {
    return this.harness.getIsRunning();
  }
  get turnStartTime(): number | null {
    return this.turnStartedAt;
  }

  get isAwaitingPersonaBootstrap(): boolean {
    return this.awaitingPersonaBootstrapInput;
  }

  private emitBootstrapProgress(
    stageOrEvent: string | PersonaBootstrapProgressEvent,
    message?: string
  ): void {
    const payload: PersonaBootstrapProgressEvent =
      typeof stageOrEvent === "string"
        ? { stage: stageOrEvent, message: message ?? "", at: Date.now() }
        : stageOrEvent;
    this.emit("persona_bootstrap_progress", payload);
  }

  /** Persisted persona + bootstrap gate (mirrors web `AgentBridge.beginSession`). */
  async beginSession(): Promise<void> {
    await runWithWorkspaceRoot(this.workspaceRoot, async () => {
      const forceBootstrap = process.env["AGENT_PERSONA_BOOTSTRAP_FORCE"] === "1";
      const bootstrapPending =
        process.env["AGENT_PERSONA_BOOTSTRAP"] !== "0" &&
        (forceBootstrap || !this.harness.isPersonaBootstrapCompleted());
      this.awaitingPersonaBootstrapInput = bootstrapPending;
      if (bootstrapPending) return;
      const persisted = this.harness.getPersistedPersonaProfile();
      if (persisted) {
        await applyPersonaProfileToHarness(this.harness, persisted).catch(() => undefined);
      }
    });
  }

  async submitPersonaBootstrap(input: string, options?: { skip?: boolean }): Promise<void> {
    if (!this.awaitingPersonaBootstrapInput) {
      throw new Error("Persona bootstrap is not pending.");
    }
    if (this.harness.getIsRunning()) {
      throw new Error("Session is still initializing. Retry in a moment.");
    }
    if (this.bootstrapInFlight) {
      throw new Error("Persona bootstrap is already in progress.");
    }
    this.bootstrapInFlight = true;
    this.emitBootstrapProgress("starting", "Bootstrap started…");
    try {
      await runWithWorkspaceRoot(this.workspaceRoot, async () => {
        const trimmed = input.trim();
        const skipAllowed = process.env["AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP"] !== "0";
        if (options?.skip || (skipAllowed && /^(skip|\/skip)$/i.test(trimmed))) {
          this.emitBootstrapProgress("skip", "Installing default Liminal persona…");
          this.awaitingPersonaBootstrapInput = false;
          await installDefaultPersonaArtifacts(this.harness, { sourcePrompt: "" });
          await this.harness.sendSessionGreeting();
          this.emitBootstrapProgress("done", "Session ready.");
          return;
        }
        const parsed = parsePersonaInput(trimmed);
        if (!parsed.coreInput) {
          throw new Error("Describe the voice you want before continuing.");
        }
        this.emitBootstrapProgress("parsed", "Building persona profile…");
        if (isResetToDefaultRequest(parsed.coreInput)) {
          this.harness.resetPersona();
          await installDefaultPersonaArtifacts(this.harness);
          this.awaitingPersonaBootstrapInput = false;
          await this.harness.sendSessionGreeting();
          this.emitBootstrapProgress("done", "Session ready.");
          return;
        }
        this.emitBootstrapProgress("generating", "Generating persona…");
        const bundle = await generatePersonaFromInput(
          this.harness,
          parsed.coreInput,
          parsed.strength,
          parsed.modifier,
          (stage, msg, detail) =>
            this.emitBootstrapProgress({
              stage,
              message: msg,
              at: Date.now(),
              artifacts: detail?.artifacts,
            })
        );
        await applyPersonaProfileToHarness(this.harness, bundle.profile);
        await this.harness.patchRuntimePreferences(
          {
            persona: {
              bootstrapCompleted: true,
              sourcePrompt: parsed.coreInput,
              activeProfile: bundle.profile,
              controls: bundle.defaultControls,
              updatedAt: Date.now(),
            },
          },
          { persist: true }
        );
        this.awaitingPersonaBootstrapInput = false;
        await this.harness.sendSessionGreeting();
        this.emitBootstrapProgress("done", "Bootstrap complete.");
      });
    } finally {
      this.bootstrapInFlight = false;
    }
  }

  async refreshProviderConfig(): Promise<void> {
    if (this.harness.getIsRunning()) {
      throw new Error("Agent is busy; finish the current turn first.");
    }
    await this.harness.refreshProviderConfig();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    if (!this.turnStartedAt) this.turnStartedAt = Date.now();
    const tick = (): void => {
      if (!this.harness.getIsRunning()) {
        this.stopHeartbeat();
        return;
      }
      this.emit("harness_running", { chatId: this.chatId, startedAt: this.turnStartedAt! });
    };
    tick();
    this.heartbeatTimer = setInterval(tick, 5_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.turnStartedAt = null;
  }

  private wireEvents(): void {
    const { emitter } = this.harness;
    const on = <K extends Parameters<typeof emitter.on>[0]>(
      event: K,
      handler: Parameters<typeof emitter.on<K>>[1]
    ): void => {
      emitter.on(event, handler);
      this.detachers.push(() => emitter.off(event, handler));
    };

    // Streaming + lifecycle — forwarded verbatim (already wire-safe).
    on("text", (p) => {
      this.startHeartbeat();
      this.emit("text", p);
    });
    on("provider_retry", (p) => {
      this.startHeartbeat();
      this.emit("provider_retry", p);
    });
    on("tool_start", (p) => {
      this.startHeartbeat();
      this.emit("tool_start", p);
    });
    on("speech", (p) => this.emit("speech", p));
    on("browser_view", (p) => this.emit("browser_view", p));
    on("terminal_view", (p) => this.emit("terminal_view", p));
    on("tool_delta", (p) => this.emit("tool_delta", p));
    on("compose_preview", (p) => this.emit("compose_preview", p));
    on("tool_result", (p) => this.emit("tool_result", wireToolResult(p)));
    on("turn_summary", (p) => this.emit("turn_summary", p));
    on("turn_end", (p) => {
      this.stopHeartbeat();
      this.emit("turn_end", p);
    });
    on("error", (p) => {
      this.stopHeartbeat();
      this.emit("error", wireError(p));
    });

    // Sub-agents.
    on("subtask_spawned", (p) => this.emit("subtask_spawned", p));
    on("subtask_complete", (p) => this.emit("subtask_complete", p));
    on("subtask_output", (p) => this.emit("subtask_output", p));
    on("subtask_trace", (p) => this.emit("subtask_trace", p));
    on("subtask_tool_start", (p) => this.emit("subtask_tool_start", p));
    on("subtask_tool_result", (p) => this.emit("subtask_tool_result", p));

    // Working-state, drift, telemetry surfaces.
    on("ask_user_answered", (p) => this.emit("ask_user_answered", p));
    on("approval_decision", (p) => this.emit("approval_decision", p));
    on("context_compressed", (p) => this.emit("context_compressed", p));
    on("context_snapshot", (p) => this.emit("context_snapshot", p));
    on("tool_timing", (p) => this.emit("tool_timing", p));
    on("tool_progress", (p) => this.emit("tool_progress", p));
    on("persona_changed", (p) => this.emit("persona_changed", p));
    on("execution_state", (p) => this.emit("execution_state", p));
    on("contract_transition", (p) => this.emit("contract_transition", p));
    on("contract_violation", (p) => this.emit("contract_violation", p));
    on("recovery_action", (p) => this.emit("recovery_action", p));
    on("drift_detected", (p) => this.emit("drift_detected", p));
    on("runtime_heartbeat", (p) => this.emit("runtime_heartbeat", p));
    on("vault_activity", (p) => this.emit("vault_activity", p));
    on("runtime_pref_detected", (p) => this.emit("runtime_pref_detected", p));
    on("runtime_pref_changed", (p) => this.emit("runtime_pref_changed", p));
    on("runtime_pref_persisted", (p) => this.emit("runtime_pref_persisted", p));
    on("runtime_pref_rejected", (p) => this.emit("runtime_pref_rejected", p));
    on("auto_dream", (p) => this.emit("auto_dream", p));
    on("heartbeat_scheduled", (p) => this.emit("heartbeat_scheduled", p));
    on("heartbeat_started", (p) => this.emit("heartbeat_started", p));
    on("heartbeat_completed", (p) => this.emit("heartbeat_completed", p));
    on("heartbeat_skipped", (p) => this.emit("heartbeat_skipped", p));

    // Interactive gates — sidecar holds the resolver; UI replies via a command.
    on("tool_approval", (payload) => {
      const nonce = randomBytes(16).toString("hex");
      this.pendingApprovals.set(payload.callId, { resolve: payload.resolve, nonce });
      this.emit("tool_approval", wireToolApproval(payload, nonce));
    });
    on("ask_user", (payload) => {
      this.pendingAskUser = payload.resolve;
      this.emit("ask_user", wireAskUser(payload));
    });
  }

  /** Resolve a pending approval. Returns false on unknown callId or nonce mismatch. */
  resolveApproval(callId: string, decision: ApprovalDecision, approvalNonce: string): boolean {
    const pending = this.pendingApprovals.get(callId);
    if (!pending || pending.nonce !== approvalNonce) return false;
    pending.resolve(decision);
    this.pendingApprovals.delete(callId);
    return true;
  }

  /** Answer a pending ask_user. Returns false when none is outstanding. */
  resolveAskUser(answer: string): boolean {
    if (!this.pendingAskUser) return false;
    this.pendingAskUser(answer);
    this.pendingAskUser = null;
    return true;
  }

  /** Start a turn, pinned to this chat's workspace so file/git/repo tools resolve correctly. */
  async sendUserMessage(
    message: string,
    opts?: {
      freshContext?: boolean;
      liveDictation?: boolean;
      chatAttachments?: import("@liminal/core").ChatFileAttachment[];
      /** @deprecated use chatAttachments */
      imageAttachments?: import("@liminal/core").ImageAttachment[];
      workflowPreset?: import("@liminal/core").ReceiptWorkflowPreset;
    }
  ): Promise<void> {
    if (this.awaitingPersonaBootstrapInput) {
      throw new Error("Complete persona setup before chatting.");
    }
    await runWithWorkspaceRoot(this.workspaceRoot, async () => {
      const run = this.harness.send(message, {
        freshContext: opts?.freshContext,
        liveDictation: opts?.liveDictation,
        chatAttachments: opts?.chatAttachments ?? opts?.imageAttachments,
        workflowPreset: opts?.workflowPreset,
      });
      this.startHeartbeat();
      await run;
    });
  }

  /** Cooperatively abort the in-flight turn, if any. */
  abort(): boolean {
    if (!this.harness.getIsRunning()) return false;
    this.harness.abortCurrentTurn();
    return true;
  }

  /** Run the opening greeting (used after reset when `greet` is requested). */
  async greet(): Promise<void> {
    await runWithWorkspaceRoot(this.workspaceRoot, async () => {
      const run = this.harness.sendSessionGreeting();
      this.startHeartbeat();
      await run;
    });
  }

  /** Restore UI + harness context from `session.jsonl` after restart. */
  async replayPersistedTranscript(opts?: { uiOnly?: boolean }): Promise<void> {
    let entries = await loadChatTranscriptFromSessionLog(this.chatId);
    if (entries.length === 0) {
      entries = buildTranscriptReplayFromConversation(
        this.harness.getContext().getConversationMessages()
      );
    }
    if (entries.length === 0) return;
    if (!opts?.uiOnly && !this.transcriptHydrated) {
      const pairs = conversationEntriesForHydration(entries);
      this.harness.restoreConversationFromTranscript(pairs);
      this.transcriptHydrated = true;
    }
    this.emit("transcript_replay", {
      chatId: this.chatId,
      entries: slimReplayEntriesForWire(entries),
    });
  }

  /** Clear the transcript without disposing the harness. */
  clearSession(): void {
    this.harness.clearConversation();
    this.awaitingPersonaBootstrapInput = false;
    this.transcriptHydrated = false;
  }

  /** Clear transcript + persona state and reopen bootstrap when enabled. */
  async resetPersonaBootstrapForSession(): Promise<void> {
    this.harness.clearConversation();
    this.bootstrapInFlight = false;
    this.transcriptHydrated = false;
    await resetPersonaBootstrapState(this.harness);
    await this.beginSession();
  }

  /** Detach all emitter subscriptions and reject any in-flight gates. */
  dispose(): void {
    this.stopHeartbeat();
    for (const off of this.detachers) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this.detachers = [];
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
  }
}
