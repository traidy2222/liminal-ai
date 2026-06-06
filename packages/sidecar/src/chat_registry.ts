import { rm } from "node:fs/promises";
import path from "node:path";
import {
  AgentHarness,
  conversationEntriesForHydration,
  createChatMetadata,
  globalChatsRoot,
  listChats,
  loadChatTranscriptFromSessionLog,
  loadRuntimePreferences,
  maybeAttachSessionEventLog,
  readChatMetadata,
  resolveChatBoot,
  resolveWorkspaceRoot,
  runWithWorkspaceRoot,
  saveLastActiveChatId,
  saveRuntimePreferences,
  touchChatMetadata,
  workspaceFingerprint,
  type ChatMetadata,
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
  repoRoot: string;
  sink: FrameSink;
}

/**
 * Disk-backed multi-chat registry — shares `~/.liminal/chats/` with web and TUI.
 */
export class ChatRegistry {
  private readonly slots = new Map<string, ChatSlot>();
  private activeChatId: string | null = null;
  private readonly deps: ChatRegistryDeps;
  private cachedRuntimePrefs: RuntimePreferences | null;
  private diskMetas: ChatMetadata[] = [];
  private booted = false;
  private bootPromise: Promise<void> | null = null;
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
    const root = this.deps.repoRoot.trim() || resolveWorkspaceRoot();
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

  async boot(): Promise<void> {
    if (this.booted) return;
    if (this.bootPromise) return this.bootPromise;
    this.bootPromise = (async () => {
      const { meta } = await resolveChatBoot({
        defaultWorkspaceRoot: this.deps.repoRoot,
      });
      await this.refreshDiskMetas();
      await this.openBridgeFromMeta(meta);
      this.activeChatId = meta.chatId;
      await saveLastActiveChatId(meta.chatId);
      this.booted = true;
    })().finally(() => {
      this.bootPromise = null;
    });
    return this.bootPromise;
  }

  private async refreshDiskMetas(): Promise<void> {
    this.diskMetas = await listChats();
  }

  private async openBridgeFromMeta(meta: ChatMetadata): Promise<SessionBridge> {
    const existing = this.slots.get(meta.chatId);
    if (existing) return existing.bridge;

    const { provider } = this.deps;
    const runtimePreferences = this.cachedRuntimePrefs;
    const workspaceRoot = meta.workspaceRoot;

    const harness = runWithWorkspaceRoot(workspaceRoot, () =>
      new AgentHarness({
        openRouterApiKey: provider.apiKey,
        model: provider.model,
        baseURL: provider.baseURL,
        taskId: meta.chatId,
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

    const bridge = new SessionBridge(harness, meta.chatId, workspaceRoot, this.deps.sink);
    await bridge.replayPersistedTranscript();

    this.slots.set(meta.chatId, {
      bridge,
      title: meta.title,
      workspaceRoot,
      updatedAt: meta.updatedAt,
    });
    void bridge.beginSession().then(() => this.deps.sink(serverFrame("chat_list", this.chatListPayload())));
    return bridge;
  }

  /** Build a harness + bridge for a new chat and make it active. */
  async create(input?: { workspaceRoot?: string; title?: string }): Promise<SessionBridge> {
    await this.boot();
    const workspaceRoot = input?.workspaceRoot?.trim() || this.deps.repoRoot || resolveWorkspaceRoot();
    const chatId = `chat_${Date.now().toString(36)}`;
    const meta = await createChatMetadata({
      chatId,
      title: input?.title?.trim() || "New chat",
      workspaceMode: "folder",
      workspaceRoot,
      workspaceFingerprint: workspaceFingerprint(workspaceRoot),
    });
    await this.refreshDiskMetas();
    const bridge = await this.openBridgeFromMeta(meta);
    this.activeChatId = meta.chatId;
    await saveLastActiveChatId(meta.chatId);
    return bridge;
  }

  private chatListPayload(): { chats: ChatSummary[]; activeChatId: string } {
    return { chats: this.list(), activeChatId: this.activeChatId ?? "" };
  }

  get(chatId: string): SessionBridge | undefined {
    return this.slots.get(chatId)?.bridge;
  }

  resolveBridgeForAudio(chatId: string | null): SessionBridge | undefined {
    if (chatId) {
      const bridge = this.get(chatId);
      if (bridge) return bridge;
    }
    return this.getActiveBridge();
  }

  resolveWorkspaceForMedia(chatId: string | null): string | null {
    if (chatId) {
      const slot = this.slots.get(chatId);
      if (slot) return slot.workspaceRoot;
      const meta = this.diskMetas.find((m) => m.chatId === chatId);
      if (meta) return meta.workspaceRoot;
    }
    if (this.activeChatId) {
      const active = this.slots.get(this.activeChatId);
      if (active) return active.workspaceRoot;
    }
    return null;
  }

  async getOrCreateActive(): Promise<SessionBridge> {
    await this.boot();
    if (this.activeChatId) {
      const slot = this.slots.get(this.activeChatId);
      if (slot) return slot.bridge;
      const meta = await readChatMetadata(this.activeChatId);
      if (meta) return this.openBridgeFromMeta(meta);
    }
    if (!this.ensureActive) {
      this.ensureActive = this.create().finally(() => {
        this.ensureActive = null;
      });
    }
    return this.ensureActive;
  }

  async activate(chatId: string): Promise<boolean> {
    await this.boot();
    const meta = await readChatMetadata(chatId);
    if (!meta) return false;
    await this.openBridgeFromMeta(meta);
    this.activeChatId = chatId;
    await saveLastActiveChatId(chatId);
    await touchChatMetadata(chatId);
    const slot = this.slots.get(chatId);
    if (slot) slot.updatedAt = Date.now();
    await slot?.bridge.replayPersistedTranscript({ uiOnly: true });
    return true;
  }

  async delete(chatId: string): Promise<string | null> {
    const slot = this.slots.get(chatId);
    if (slot) {
      slot.bridge.dispose();
      this.slots.delete(chatId);
    }
    try {
      await rm(path.join(globalChatsRoot(), chatId), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    await this.refreshDiskMetas();
    if (this.activeChatId === chatId) {
      const next = this.diskMetas[0];
      if (next) {
        await this.activate(next.chatId);
      } else {
        this.activeChatId = null;
      }
    }
    return this.activeChatId;
  }

  touch(chatId: string, title?: string): void {
    const slot = this.slots.get(chatId);
    if (!slot) return;
    slot.updatedAt = Date.now();
    if (title && (slot.title === "New chat" || !slot.title)) slot.title = title;
    void touchChatMetadata(chatId).catch(() => undefined);
  }

  list(): ChatSummary[] {
    const source = this.diskMetas.length > 0 ? this.diskMetas : [];
    if (source.length === 0) {
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
    return source
      .map((meta) => {
        const slot = this.slots.get(meta.chatId);
        return {
          chatId: meta.chatId,
          title: slot?.title ?? meta.title,
          workspaceRoot: meta.workspaceRoot,
          updatedAt: slot?.updatedAt ?? meta.updatedAt,
          busy: slot?.bridge.isBusy ?? false,
          active: meta.chatId === this.activeChatId,
          awaitingPersonaBootstrap: slot?.bridge.isAwaitingPersonaBootstrap ?? false,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  disposeAll(): void {
    for (const slot of this.slots.values()) slot.bridge.dispose();
    this.slots.clear();
    this.activeChatId = null;
    this.booted = false;
  }
}
