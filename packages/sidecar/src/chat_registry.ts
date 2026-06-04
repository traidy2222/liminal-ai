import { randomUUID } from "node:crypto";
import {
  AgentHarness,
  loadRuntimePreferences,
  maybeAttachSessionEventLog,
  resolveWorkspaceRoot,
  runWithWorkspaceRoot,
  saveRuntimePreferences,
  type ProviderConfig,
  type RuntimePreferences,
} from "@liminal/core";
import {
  registerAllTools,
  INCEPTION_MESSAGES,
  buildProtocolDynamicSuffix,
  applyPersonaProfileToHarness,
  type ProtocolIntentHint,
} from "@liminal/tools";
import { serverFrame, type ChatSummary } from "@liminal/protocol";
import { SessionBridge, type FrameSink } from "./session_bridge.js";

interface ChatSlot {
  bridge: SessionBridge;
  title: string;
  workspaceRoot: string;
  updatedAt: number;
}

export interface ChatRegistryDeps {
  provider: ProviderConfig;
  runtimePreferences: RuntimePreferences | null;
  /** Outbound frame sink (fans a frame to every attached UI socket). */
  sink: FrameSink;
}

/**
 * Owns every live chat = one {@link AgentHarness} + {@link SessionBridge}.
 *
 * The sidecar analogue of the web `ChatManager`, minus the SSE
 * suspend/resume dance: every bridge emits through the shared sink and frames
 * are chat-tagged, so the UI multiplexes by `chatId` and several chats can run
 * concurrently without bleeding into each other.
 */
export class ChatRegistry {
  private readonly slots = new Map<string, ChatSlot>();
  private activeChatId: string | null = null;
  private readonly deps: ChatRegistryDeps;
  private cachedRuntimePrefs: RuntimePreferences | null;
  /** Single-flight guard when multiple WS clients call `getOrCreateActive` at once. */
  private ensureActive: Promise<SessionBridge> | null = null;

  constructor(deps: ChatRegistryDeps) {
    this.deps = deps;
    this.cachedRuntimePrefs = deps.runtimePreferences;
  }

  getActiveBridge(): SessionBridge | undefined {
    if (!this.activeChatId) return undefined;
    return this.slots.get(this.activeChatId)?.bridge;
  }

  async reloadRuntimePrefs(): Promise<void> {
    const root = process.env["LIMINAL_REPO_ROOT"]?.trim() || resolveWorkspaceRoot();
    this.cachedRuntimePrefs = await loadRuntimePreferences(root).catch(() => null);
  }

  async reapplyAllProviders(): Promise<void> {
    for (const slot of this.slots.values()) {
      if (slot.bridge.harness.getIsRunning()) continue;
      await slot.bridge.refreshProviderConfig().catch(() => undefined);
    }
  }

  get activeId(): string | null {
    return this.activeChatId;
  }

  /** Build a harness + bridge for a new chat and make it active. */
  async create(input?: { workspaceRoot?: string; title?: string }): Promise<SessionBridge> {
    const chatId = randomUUID();
    const workspaceRoot = input?.workspaceRoot?.trim() || resolveWorkspaceRoot();
    const { provider } = this.deps;
    const runtimePreferences = this.cachedRuntimePrefs;

    const harness = runWithWorkspaceRoot(workspaceRoot, () =>
      new AgentHarness({
        openRouterApiKey: provider.apiKey,
        model: provider.model,
        baseURL: provider.baseURL,
        taskId: chatId,
        workspaceRoot,
        maxToolRoundsPerTurn: 128,
        workingStateEnabled: true,
        runtimePreferences,
        persistRuntimePreferences: async (prefs) =>
          saveRuntimePreferences(prefs, workspaceRoot),
        context: {
          modelMaxTokens: 128_000,
          thresholdFraction: 0.6,
          inceptionMessages: INCEPTION_MESSAGES,
          protocolDynamicBuilder: (names, hint) =>
            buildProtocolDynamicSuffix(names, (hint ?? "any") as ProtocolIntentHint),
        },
      })
    );

    maybeAttachSessionEventLog(harness.emitter, harness.taskId);

    await runWithWorkspaceRoot(workspaceRoot, async () => {
      registerAllTools(harness.registry, harness.emitter, harness);
      const persisted = harness.getPersistedPersonaProfile();
      if (persisted) {
        await applyPersonaProfileToHarness(harness, persisted).catch(() => undefined);
      }
    });

    const bridge = new SessionBridge(harness, chatId, workspaceRoot, this.deps.sink);
    this.slots.set(chatId, {
      bridge,
      title: input?.title?.trim() || "New chat",
      workspaceRoot,
      updatedAt: Date.now(),
    });
    this.activeChatId = chatId;
    void bridge.beginSession().then(() => this.deps.sink(serverFrame("chat_list", this.chatListPayload())));
    return bridge;
  }

  private chatListPayload(): { chats: ChatSummary[]; activeChatId: string } {
    return { chats: this.list(), activeChatId: this.activeChatId ?? "" };
  }

  get(chatId: string): SessionBridge | undefined {
    return this.slots.get(chatId)?.bridge;
  }

  /** Workspace root for `/media` — prefers explicit chat, else active chat. */
  resolveWorkspaceForMedia(chatId: string | null): string | null {
    if (chatId) {
      const slot = this.slots.get(chatId);
      if (slot) return slot.workspaceRoot;
    }
    if (this.activeChatId) {
      const active = this.slots.get(this.activeChatId);
      if (active) return active.workspaceRoot;
    }
    return null;
  }

  /** The active chat's bridge, creating one lazily if none exists yet. */
  async getOrCreateActive(): Promise<SessionBridge> {
    if (this.activeChatId) {
      const slot = this.slots.get(this.activeChatId);
      if (slot) return slot.bridge;
    }
    if (!this.ensureActive) {
      this.ensureActive = this.create().finally(() => {
        this.ensureActive = null;
      });
    }
    return this.ensureActive;
  }

  activate(chatId: string): boolean {
    if (!this.slots.has(chatId)) return false;
    this.activeChatId = chatId;
    this.touch(chatId);
    return true;
  }

  delete(chatId: string): string | null {
    const slot = this.slots.get(chatId);
    if (!slot) return this.activeChatId;
    slot.bridge.dispose();
    this.slots.delete(chatId);
    if (this.activeChatId === chatId) {
      // Pick the most-recently-active remaining chat, if any.
      const next = [...this.slots.entries()].sort(
        (a, b) => b[1].updatedAt - a[1].updatedAt
      )[0];
      this.activeChatId = next ? next[0] : null;
    }
    return this.activeChatId;
  }

  /** Bump a chat's activity timestamp (drives most-recent-first ordering). */
  touch(chatId: string, title?: string): void {
    const slot = this.slots.get(chatId);
    if (!slot) return;
    slot.updatedAt = Date.now();
    if (title && (slot.title === "New chat" || !slot.title)) slot.title = title;
  }

  list(): ChatSummary[] {
    return [...this.slots.entries()]
      .map(([chatId, slot]) => ({
        chatId,
        title: slot.title,
        workspaceRoot: slot.workspaceRoot,
        updatedAt: slot.updatedAt,
        busy: slot.bridge.isBusy,
        active: chatId === this.activeChatId,
        awaitingPersonaBootstrap: slot.bridge.isAwaitingPersonaBootstrap,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Dispose every chat (clean shutdown). */
  disposeAll(): void {
    for (const slot of this.slots.values()) slot.bridge.dispose();
    this.slots.clear();
    this.activeChatId = null;
  }
}
