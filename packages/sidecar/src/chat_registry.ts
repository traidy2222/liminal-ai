import { rm } from "node:fs/promises";
import path from "node:path";
import {
  AgentHarness,
  conversationEntriesForHydration,
  createChatMetadata,
  globalChatsRoot,
  isBundledRepoPath,
  listChats,
  loadChatTranscriptFromSessionLog,
  loadRuntimePreferences,
  maybeAttachSessionEventLog,
  readChatMetadata,
  resolveChatBoot,
  recoverManagedInferencePreferences,
  resolveProviderConfigWithInference,
  resolveWorkspaceRoot,
  runWithWorkspaceRoot,
  saveLastActiveChatId,
  saveRuntimePreferences,
  touchChatMetadata,
  workspaceFingerprint,
  ChatTitleRefresher,
  type ChatKind,
  type ChatMetadata,
  type ChatWorkspaceMode,
  type ProviderConfig,
  type RuntimePreferences,
} from "@liminal/core";
import {
  registerAllTools,
  INCEPTION_MESSAGES,
  buildProtocolDynamicSuffix,
  applyPersonaProfileToHarness,
  installDefaultPersonaArtifacts,
  type ProtocolIntentHint,
  type RegisterAllToolsDeps,
} from "@liminal/tools";
import { serverFrame, type ChatSummary } from "@liminal/protocol";
import { SessionBridge, type FrameSink } from "./session_bridge.js";
import { buildOrchestratorInceptionMessages } from "./orchestrator_chat_prompt.js";
import { registerOrchestratorChatTools } from "./orchestrator_chat_tools.js";
import type { ChatOrchestrator } from "./chat_orchestrator.js";
import { resolveNewChatWorkspace } from "./chat_workspace_resolve.js";

interface ChatSlot {
  bridge: SessionBridge;
  title: string;
  kind?: ChatKind;
  workspaceRoot: string;
  updatedAt: number;
}

export interface ChatRegistryDeps {
  provider: ProviderConfig;
  runtimePreferences: RuntimePreferences | null;
  repoRoot: string;
  sink: FrameSink;
  registerToolsDeps?: RegisterAllToolsDeps;
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
  private getOrchestrator?: () => ChatOrchestrator;
  private readonly titleRefresher: ChatTitleRefresher;
  private readonly titleRefreshDetach = new Map<string, () => void>();

  constructor(deps: ChatRegistryDeps) {
    this.deps = deps;
    this.cachedRuntimePrefs = deps.runtimePreferences;
    this.titleRefresher = new ChatTitleRefresher({
      getRuntimePrefs: () => this.cachedRuntimePrefs,
      onTitleUpdated: async (chatId, title) => {
        const slot = this.slots.get(chatId);
        if (slot) slot.title = title;
        await this.refreshDiskMetas();
        this.deps.sink(serverFrame("chat_list", this.chatListPayload()));
      },
    });
  }

  /** Wired after {@link ChatOrchestrator} construction (avoids circular deps). */
  setOrchestrator(getter: () => ChatOrchestrator): void {
    this.getOrchestrator = getter;
  }

  getActiveBridge(): SessionBridge | undefined {
    if (!this.activeChatId) return undefined;
    return this.slots.get(this.activeChatId)?.bridge;
  }

  async reloadRuntimePrefs(): Promise<void> {
    const root = this.deps.repoRoot.trim() || resolveWorkspaceRoot();
    this.cachedRuntimePrefs = await loadRuntimePreferences(root).catch(() => null);
  }

  async recoverManagedInferenceIfNeeded(): Promise<boolean> {
    const root = this.deps.repoRoot.trim() || resolveWorkspaceRoot();
    const prefs =
      this.cachedRuntimePrefs ?? (await loadRuntimePreferences(root).catch(() => null));
    const { recovered, prefs: next } = await recoverManagedInferencePreferences(prefs);
    if (!recovered || !next) return false;
    await saveRuntimePreferences(next, root);
    this.cachedRuntimePrefs = next;
    this.deps.runtimePreferences = next;
    return true;
  }

  async reapplyAllProviders(): Promise<void> {
    await this.reloadRuntimePrefs();
    await this.recoverManagedInferenceIfNeeded();
    await this.reloadRuntimePrefs();
    try {
      const modelOverride =
        this.cachedRuntimePrefs?.provider?.model?.trim() ||
        this.cachedRuntimePrefs?.harness?.env?.AGENT_MODEL?.trim();
      this.deps.provider = await resolveProviderConfigWithInference(
        modelOverride ? { model: modelOverride } : undefined,
        this.cachedRuntimePrefs
      );
    } catch {
      /* keep prior provider snapshot */
    }
    for (const slot of this.slots.values()) {
      if (slot.bridge.harness.getIsRunning()) continue;
      await slot.bridge.harness.recoverManagedInferenceRouteIfNeeded().catch(() => false);
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
        rejectDefaultWorkspace: (p) => isBundledRepoPath(p, this.deps.repoRoot),
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
    if (existing) {
      this.wireChatTitleRefresh(meta, existing.bridge);
      return existing.bridge;
    }

    const { provider } = this.deps;
    const runtimePreferences = this.cachedRuntimePrefs;
    const workspaceRoot = meta.workspaceRoot;
    const isOrchestrator = meta.kind === "orchestrator";

    const harness = runWithWorkspaceRoot(workspaceRoot, () =>
      new AgentHarness({
        openRouterApiKey: provider.apiKey,
        model: provider.model,
        baseURL: provider.baseURL,
        taskId: meta.chatId,
        workspaceRoot,
        maxToolRoundsPerTurn: isOrchestrator ? 48 : 128,
        workingStateEnabled: true,
        runtimePreferences,
        persistRuntimePreferences: async (prefs) =>
          saveRuntimePreferences(prefs, workspaceRoot),
        context: {
          modelMaxTokens: 128_000,
          thresholdFraction: 0.6,
          inceptionMessages: isOrchestrator
            ? buildOrchestratorInceptionMessages()
            : INCEPTION_MESSAGES,
          protocolDynamicBuilder: (names, hint) =>
            buildProtocolDynamicSuffix(names, (hint ?? "any") as ProtocolIntentHint),
        },
      })
    );

    maybeAttachSessionEventLog(harness.emitter, harness.taskId);

    await runWithWorkspaceRoot(workspaceRoot, async () => {
      await registerAllTools(harness.registry, harness.emitter, harness, this.deps.registerToolsDeps);
      if (isOrchestrator) {
        const orch = this.getOrchestrator?.();
        if (orch) {
          registerOrchestratorChatTools(harness.registry, orch, meta.chatId);
        }
        if (!harness.isPersonaBootstrapCompleted()) {
          await installDefaultPersonaArtifacts(harness);
          await harness.patchRuntimePreferences(
            {
              persona: {
                bootstrapCompleted: true,
                sourcePrompt: "Mission Control",
                updatedAt: Date.now(),
              },
            },
            { persist: true }
          );
        }
      } else {
        const persisted = harness.getPersistedPersonaProfile();
        if (persisted) {
          await applyPersonaProfileToHarness(harness, persisted).catch(() => undefined);
        }
      }
    });

    const bridge = new SessionBridge(harness, meta.chatId, workspaceRoot, this.deps.sink);
    await bridge.replayPersistedTranscript();

    this.slots.set(meta.chatId, {
      bridge,
      title: meta.title,
      kind: meta.kind,
      workspaceRoot,
      updatedAt: meta.updatedAt,
    });
    this.wireChatTitleRefresh(meta, bridge);
    void bridge.beginSession().then(() => this.deps.sink(serverFrame("chat_list", this.chatListPayload())));
    return bridge;
  }

  private wireChatTitleRefresh(meta: ChatMetadata, bridge: SessionBridge): void {
    this.titleRefreshDetach.get(meta.chatId)?.();
    this.titleRefreshDetach.delete(meta.chatId);
    if (meta.kind === "orchestrator") return;
    const onTurnEnd = (): void => {
      this.titleRefresher.scheduleAfterTurn(meta.chatId);
    };
    bridge.harness.emitter.on("turn_end", onTurnEnd);
    this.titleRefreshDetach.set(meta.chatId, () => {
      bridge.harness.emitter.off("turn_end", onTurnEnd);
    });
  }

  /** Build a harness + bridge for a new chat and make it active. */
  async create(input?: {
    workspaceRoot?: string;
    workspaceMode?: ChatWorkspaceMode;
    title?: string;
    kind?: ChatKind;
  }): Promise<SessionBridge> {
    await this.boot();
    const kind = input?.kind ?? "default";
    const chatId =
      kind === "orchestrator"
        ? `orch_${Date.now().toString(36)}`
        : `chat_${Date.now().toString(36)}`;
    const { mode, root } = await resolveNewChatWorkspace({
      chatId,
      repoRoot: this.deps.repoRoot,
      workspaceMode: input?.workspaceMode,
      workspaceRoot: input?.workspaceRoot,
      orchestrator: kind === "orchestrator",
    });
    const meta = await createChatMetadata({
      chatId,
      title: input?.title?.trim() || (kind === "orchestrator" ? "Mission Control" : "New chat"),
      kind: kind === "default" ? undefined : kind,
      workspaceMode: mode,
      workspaceRoot: root,
      workspaceFingerprint: workspaceFingerprint(root),
    });
    await this.refreshDiskMetas();
    const bridge = await this.openBridgeFromMeta(meta);
    this.activeChatId = meta.chatId;
    await saveLastActiveChatId(meta.chatId);
    return bridge;
  }

  /** Persistent Mission Control chat — created once per install, reused thereafter. */
  async getOrCreateOrchestratorChat(): Promise<SessionBridge> {
    await this.boot();
    await this.refreshDiskMetas();
    const existing = this.diskMetas.find((m) => m.kind === "orchestrator");
    if (existing) {
      const bridge = await this.openBridgeFromMeta(existing);
      this.activeChatId = existing.chatId;
      await saveLastActiveChatId(existing.chatId);
      return bridge;
    }
    return this.create({ kind: "orchestrator", title: "Mission Control" });
  }

  private chatListPayload(): { chats: ChatSummary[]; activeChatId: string } {
    return { chats: this.list(), activeChatId: this.activeChatId ?? "" };
  }

  get(chatId: string): SessionBridge | undefined {
    return this.slots.get(chatId)?.bridge;
  }

  listBridges(): SessionBridge[] {
    return [...this.slots.values()].map((s) => s.bridge);
  }

  anyHarnessBusy(): boolean {
    for (const slot of this.slots.values()) {
      if (slot.bridge.harness.getIsRunning()) return true;
    }
    return false;
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

  /** Open bridge for a chat without changing which chat is "active" on the server. */
  async open(chatId: string): Promise<boolean> {
    await this.boot();
    const meta = await readChatMetadata(chatId);
    if (!meta) return false;
    await this.openBridgeFromMeta(meta);
    await touchChatMetadata(chatId);
    const slot = this.slots.get(chatId);
    if (slot) slot.updatedAt = Date.now();
    return true;
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
    this.titleRefreshDetach.get(chatId)?.();
    this.titleRefreshDetach.delete(chatId);
    this.titleRefresher.forget(chatId);
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
          kind: slot.kind === "orchestrator" ? ("orchestrator" as const) : undefined,
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
          kind: meta.kind === "orchestrator" ? ("orchestrator" as const) : undefined,
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
    for (const detach of this.titleRefreshDetach.values()) detach();
    this.titleRefreshDetach.clear();
    for (const slot of this.slots.values()) slot.bridge.dispose();
    this.slots.clear();
    this.activeChatId = null;
    this.booted = false;
  }
}
