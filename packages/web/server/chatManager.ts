/**
 * Multi-chat lifecycle for the web server (Phase 2 of per-chat workspaces).
 *
 * Holds a map of `chatId → AgentBridge`, with exactly one chat designated as
 * the "active" one at any moment. The active bridge is the only SSE source —
 * other bridges keep their conversation context in memory but stay silent so
 * the UI of the active chat isn't polluted with cross-chat events.
 *
 * Switching chats:
 *   1. Suspend the previously active bridge's SSE forwarding
 *   2. Resume / lazy-construct the target chat's bridge
 *   3. Emit `chat_switched` so clients reset their UI to the target chat
 *
 * Lazy construction:
 *   - Bridges are only built on first activation (or first message). Boot is
 *     cheap regardless of how many chats are on disk.
 *
 * Idle eviction:
 *   - Bridges idle for more than `IDLE_EVICTION_MS` are disposed and removed
 *     from memory. They reconstruct on next activation, picking up persisted
 *     persona, runtime prefs, and memory (all of which live in user-global
 *     storage after Phase 1).
 *
 * Failure isolation:
 *   - A throw inside one bridge's send() never affects another bridge.
 */
import {
  createChatMetadata,
  listChats,
  readChatMetadata,
  scratchWorkspaceRoot,
  workspaceFingerprint,
  ensurePerChatDir,
  globalChatsRoot,
  loadRuntimePreferences,
  resolveChatBoot,
  resolveProviderConfigWithInference,
  saveLastActiveChatId,
  ChatTitleRefresher,
  type ChatMetadata,
  type ChatWorkspaceMode,
  type RuntimePreferences,
} from "@liminal/core";
import { rm } from "node:fs/promises";
import path from "node:path";
import { AgentBridge } from "./agentBridge.js";
import type { SSEManager } from "./sse.js";

/** How long a bridge can sit idle before we dispose it to free memory. */
const IDLE_EVICTION_MS = 30 * 60_000; // 30 minutes

/** Sentinel used when no chats exist yet — first incoming activate creates one. */
const NO_ACTIVE = "";

/**
 * Heuristic: refuse to bind a default chat to the user's home directory itself —
 * that's almost never intentional and would let the agent see everything in
 * ~/. Falls back to scratch in that case so the user explicitly picks a folder.
 */
function looksLikeUserHome(p: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { homedir } = require("node:os") as typeof import("node:os");
    return path.resolve(p) === path.resolve(homedir());
  } catch {
    return false;
  }
}

interface BridgeSlot {
  bridge: AgentBridge;
  /** Last activity timestamp (ms). Updated on resumeSSE, sendUserMessage, etc. */
  lastTouchedAt: number;
}

export class ChatManager {
  private readonly bridges = new Map<string, BridgeSlot>();
  private activeChatId: string = NO_ACTIVE;
  private evictionTimer: NodeJS.Timeout | null = null;
  /**
   * Cached runtime preferences shared by every bridge constructor. Loaded once
   * at boot from `~/.liminal/runtime_prefs.json` (with legacy workspace-local
   * fallback). Persisted on patch by each individual harness.
   */
  private cachedRuntimePrefs: RuntimePreferences | null = null;
  private readonly titleRefresher: ChatTitleRefresher;
  private readonly titleRefreshWired = new Set<string>();

  constructor(private readonly sse: SSEManager) {
    this.titleRefresher = new ChatTitleRefresher({
      getRuntimePrefs: () => this.cachedRuntimePrefs,
      onTitleUpdated: async (chatId, title) => {
        this.sse.send(
          "chat_meta_updated",
          { chatId, title, at: Date.now() },
          chatId
        );
      },
    });
  }

  /**
   * Boot the manager:
   *   1. Load runtime prefs from disk (used by every newly-built bridge).
   *   2. Discover chats already on disk.
   *   3. Pick the most-recently-updated chat as active (or create a default
   *      scratch chat if none exists yet).
   *   4. Construct + activate the chosen chat's bridge.
   *
   * The chosen bridge's `sessionReady` is awaited so first-incoming HTTP
   * traffic doesn't race tool registration / persona application.
   */
  async boot(): Promise<{ activeChatId: string; activeMeta: ChatMetadata }> {
    this.cachedRuntimePrefs = await loadRuntimePreferences().catch(() => null);

    const cwd = path.resolve(
      process.env["AGENT_WORKSPACE_ROOT"]?.trim() || process.cwd()
    );
    const { meta: chosen } = await resolveChatBoot({
      defaultWorkspaceRoot: cwd,
      looksLikeUserHome,
    });

    await this.activate(chosen.chatId, { announce: false });
    this.startEvictionTimer();
    return { activeChatId: chosen.chatId, activeMeta: chosen };
  }

  /**
   * Returns the currently-active bridge, or throws if no chat is active.
   * Callers that need an active bridge for an HTTP request should use this so
   * the failure mode is a clear 5xx rather than undefined access.
   */
  getActive(): AgentBridge {
    if (!this.activeChatId) {
      throw new Error("No active chat — call /api/chats/:id/activate first or POST /api/chats to create one.");
    }
    const slot = this.bridges.get(this.activeChatId);
    if (!slot) {
      throw new Error(`Active chat ${this.activeChatId} has no bridge slot — internal inconsistency.`);
    }
    slot.lastTouchedAt = Date.now();
    return slot.bridge;
  }

  /** Currently-active chat id (empty string when no chat is active). */
  get activeId(): string {
    return this.activeChatId;
  }

  /**
   * Activate a chat. Suspends the previously-active bridge's SSE forwarding,
   * lazy-constructs the target bridge if missing, resumes its SSE forwarding,
   * and (when `announce`) fires `chat_switched` so clients reset UI state.
   */
  async activate(chatId: string, opts?: { announce?: boolean }): Promise<ChatMetadata> {
    const meta = await readChatMetadata(chatId);
    if (!meta) {
      throw new Error(`Chat metadata not found for ${chatId}.`);
    }

    // Suspend the previous active bridge (if any and different).
    if (this.activeChatId && this.activeChatId !== chatId) {
      const prev = this.bridges.get(this.activeChatId);
      if (prev) prev.bridge.suspendSSE();
    }

    let slot = this.bridges.get(chatId);
    if (!slot) {
      // Lazy construction — first activation builds the bridge for this chat.
      // Ensure the per-chat directory exists so session.jsonl and meta.json can
      // land there without the harness having to mkdir on its first emit.
      await ensurePerChatDir(chatId);
      const provider = await resolveProviderConfigWithInference(
        this.cachedRuntimePrefs?.provider,
        this.cachedRuntimePrefs
      );
      const bridge = new AgentBridge(
        this.sse,
        { chatId, workspaceRoot: meta.workspaceRoot },
        this.cachedRuntimePrefs,
        provider
      );
      slot = { bridge, lastTouchedAt: Date.now() };
      this.bridges.set(chatId, slot);
      this.wireChatTitleRefresh(meta, bridge);
      await bridge.whenSessionReady().catch((err) => {
        // Tool registration / persona bootstrap failures shouldn't poison the
        // manager — surface via the API and let the user reset / retry.
        console.error(`[chatManager] bridge ${chatId} session init failed:`, err);
      });
    } else {
      slot.lastTouchedAt = Date.now();
    }

    this.activeChatId = chatId;
    this.sse.setActiveChatId(chatId);
    await saveLastActiveChatId(chatId).catch(() => undefined);

    await slot.bridge.resumeSSE();
    await slot.bridge.replayPersistedTranscript();

    if (opts?.announce !== false) {
      this.sse.send("chat_switched", {
        chatId,
        title: meta.title,
        workspaceRoot: meta.workspaceRoot,
        workspaceFingerprint: meta.workspaceFingerprint,
        workspaceMode: meta.workspaceMode,
        at: Date.now(),
      }, chatId);
    }

    return meta;
  }

  /**
   * Create a new chat with the given workspace mode and metadata. Does NOT
   * activate by default — caller decides (the typical UI flow is create + then
   * activate so the client sees `chat_switched`).
   */
  async create(input: {
    title?: string;
    workspaceMode: ChatWorkspaceMode;
    workspaceRoot?: string;
  }): Promise<ChatMetadata> {
    const id = `chat_${Date.now().toString(36)}`;
    let resolvedRoot: string;
    if (input.workspaceMode === "folder" || input.workspaceMode === "reuse") {
      if (!input.workspaceRoot) {
        throw new Error("workspaceRoot required for folder/reuse mode");
      }
      resolvedRoot = path.resolve(input.workspaceRoot);
    } else {
      resolvedRoot = scratchWorkspaceRoot(id);
    }
    return createChatMetadata({
      chatId: id,
      title: input.title,
      workspaceMode: input.workspaceMode,
      workspaceRoot: resolvedRoot,
      workspaceFingerprint: workspaceFingerprint(resolvedRoot),
    });
  }

  /**
   * Delete a chat: dispose its bridge if loaded, remove its per-chat dir.
   * If the deleted chat was active, pick the next-most-recent as active so
   * the UI doesn't end up with a dead pointer.
   */
  async delete(chatId: string): Promise<{ newActiveId: string | null }> {
    this.titleRefreshWired.delete(chatId);
    this.titleRefresher.forget(chatId);
    const slot = this.bridges.get(chatId);
    if (slot) {
      slot.bridge.dispose();
      this.bridges.delete(chatId);
    }
    // Blow away the chat's storage directory under ~/.liminal/chats/<chatId>/.
    try {
      const root = path.join(globalChatsRoot(), chatId);
      await rm(root, { recursive: true, force: true });
    } catch (err) {
      console.error(`[chatManager] failed to clean chat dir ${chatId}:`, err);
    }

    let newActiveId: string | null = null;
    if (this.activeChatId === chatId) {
      this.activeChatId = NO_ACTIVE;
      const remaining = await listChats();
      if (remaining.length > 0) {
        await this.activate(remaining[0]!.chatId);
        newActiveId = remaining[0]!.chatId;
      } else {
        this.sse.send("chat_switched", { chatId: "", workspaceRoot: "", at: Date.now() });
      }
    }
    return { newActiveId };
  }

  /** All currently-resident bridges (for diagnostics). */
  getResidentBridgeIds(): string[] {
    return [...this.bridges.keys()];
  }

  /**
   * Reload runtime prefs from disk and stash for future bridge constructions.
   * Existing bridges keep their already-applied prefs — they re-read on next
   * patchRuntimePreferences. Used after settings UI persists changes.
   */
  async reloadRuntimePrefs(): Promise<void> {
    this.cachedRuntimePrefs = await loadRuntimePreferences().catch(() => null);
  }

  /** Refresh active bridge provider after Vireon sign-in (license now on disk). */
  async reapplyActiveBridgeProvider(): Promise<void> {
    const chatId = this.activeChatId;
    if (!chatId) return;
    const slot = this.bridges.get(chatId);
    if (!slot) return;
    await slot.bridge.reapplyProvider(this.cachedRuntimePrefs);
  }

  /**
   * Periodic eviction of idle bridges (every 5 min). The active bridge is
   * never evicted regardless of idle time.
   */
  private startEvictionTimer(): void {
    if (this.evictionTimer) return;
    this.evictionTimer = setInterval(() => {
      const now = Date.now();
      for (const [chatId, slot] of [...this.bridges.entries()]) {
        if (chatId === this.activeChatId) continue;
        if (now - slot.lastTouchedAt < IDLE_EVICTION_MS) continue;
        try {
          slot.bridge.dispose();
        } catch {
          /* ignore */
        }
        this.bridges.delete(chatId);
      }
    }, 5 * 60_000).unref();
  }

  /** Full shutdown — disposes every bridge. Called on server SIGTERM. */
  private wireChatTitleRefresh(meta: ChatMetadata, bridge: AgentBridge): void {
    if (this.titleRefreshWired.has(meta.chatId)) return;
    this.titleRefreshWired.add(meta.chatId);
    bridge.harness.emitter.on("turn_end", () => {
      this.titleRefresher.scheduleAfterTurn(meta.chatId);
    });
  }

  shutdown(): void {
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    this.evictionTimer = null;
    for (const [, slot] of this.bridges) {
      try {
        slot.bridge.dispose();
      } catch {
        /* ignore */
      }
    }
    this.bridges.clear();
    this.activeChatId = NO_ACTIVE;
  }
}
