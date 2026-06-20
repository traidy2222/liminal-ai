/**
 * Token-gated loopback WebSocket client for `liminald` — drives real harness turns
 * during desktop marketing capture (no HTTP /api shim).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSidecarHandshake, waitForFreshHandshake } from "./marketing-sidecar.mjs";

const require = createRequire(import.meta.url);
const { WebSocket } = require(
  require.resolve("ws", { paths: [path.join(path.dirname(fileURLToPath(import.meta.url)), "../../packages/sidecar")] })
);

const PROTOCOL_VERSION = 1;
const BATCH_CHAT_TITLE = "marketing-batch-capture";
const REUSE_CHAT = process.env.MARKETING_REUSE_CHAT === "1";
const NO_FOCUS = process.env.MARKETING_CAPTURE_NO_FOCUS === "1";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class SidecarWsClient {
  /**
   * @param {number} port
   * @param {string} token
   * @param {{ onHandshakeRefresh?: () => Promise<{ port: number; token: string }> }} [opts]
   */
  constructor(port, token, opts = {}) {
    this.port = port;
    this.token = token;
    this.onHandshakeRefresh = opts.onHandshakeRefresh ?? null;
    /** @type {import("ws").WebSocket | null} */
    this.ws = null;
    /** @type {Map<string, { resolve: (v: object) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    this.cmdSeq = 0;
    /** @type {{ chatId: string; busy: boolean; title?: string; awaitingPersonaBootstrap?: boolean }[]} */
    this.chats = [];
    this.activeChatId = null;
    /** @type {object | undefined} */
    this.appConfig = undefined;
    this.sidecarReady = false;
    /** @type {Set<string>} */
    this.runningChats = new Set();
    /** @type {Set<string>} */
    this.turnEndedChats = new Set();
    /** @type {Array<(frame: object) => void>} */
    this.listeners = [];
    this._connecting = false;
  }

  onEvent(fn) {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  #rejectPending(reason) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(reason instanceof Error ? reason : new Error(String(reason)));
    }
    this.pending.clear();
  }

  #attachSocket(ws) {
    ws.on("message", (data) => this.#onMessage(String(data)));
    ws.on("close", () => {
      if (this.ws === ws) {
        this.ws = null;
        this.sidecarReady = false;
      }
      this.#rejectPending(new Error("WebSocket closed"));
    });
    ws.on("error", () => {
      /* close handler runs after error */
    });
  }

  async connect(timeoutMs = 30_000) {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this._connecting) {
      while (this._connecting) await sleep(50);
      if (this.ws?.readyState === WebSocket.OPEN) return;
    }
    this._connecting = true;
    try {
      const url = `ws://127.0.0.1:${this.port}?token=${encodeURIComponent(this.token)}`;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`WS connect timeout: ${url}`)), timeoutMs);
        const ws = new WebSocket(url);
        ws.once("open", () => {
          clearTimeout(timer);
          this.ws = ws;
          this.#attachSocket(ws);
          resolve();
        });
        ws.once("error", (err) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(`WebSocket error: ${url}`));
        });
      });
      await this.waitForSidecarReady(90_000);
    } finally {
      this._connecting = false;
    }
  }

  async reconnectFromHandshake(minStartedAt = 0) {
    this.close();
    let hs;
    if (this.onHandshakeRefresh) {
      hs = await this.onHandshakeRefresh();
    } else {
      hs = minStartedAt > 0 ? await waitForFreshHandshake(minStartedAt) : await readSidecarHandshake();
    }
    if (!hs?.port || !hs?.token) {
      throw new Error("Cannot reconnect — sidecar handshake missing");
    }
    this.port = hs.port;
    this.token = hs.token;
    this.sidecarReady = false;
    await this.connect();
  }

  async ensureConnected() {
    if (this.ws?.readyState === WebSocket.OPEN && this.sidecarReady) return;
    if (this.ws?.readyState === WebSocket.OPEN && !this.sidecarReady) {
      await this.waitForSidecarReady(90_000);
      return;
    }
    await this.reconnectFromHandshake();
  }

  #onMessage(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (frame.t !== "evt") return;

    if (frame.event === "hello" || frame.event === "sidecar_ready") {
      if (frame.data?.chats) this.chats = frame.data.chats;
      if (frame.data?.activeChatId) this.activeChatId = frame.data.activeChatId;
      if (frame.data?.appConfig) this.appConfig = frame.data.appConfig;
      if (frame.event === "sidecar_ready") this.sidecarReady = true;
    }
    if (frame.event === "chat_list") {
      this.chats = frame.data.chats ?? this.chats;
      this.activeChatId = frame.data.activeChatId ?? this.activeChatId;
    }
    if (frame.event === "harness_running" && frame.chatId) {
      this.runningChats.add(frame.chatId);
      this.turnEndedChats.delete(frame.chatId);
    }
    if (frame.event === "turn_end" && frame.chatId) {
      this.runningChats.delete(frame.chatId);
      this.turnEndedChats.add(frame.chatId);
    }
    if (frame.event === "command_result") {
      const { commandId, ok, error, data } = frame.data ?? {};
      const pending = this.pending.get(commandId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(commandId);
        pending.resolve({ ok, error, data });
      }
    }

    for (const fn of this.listeners) {
      try {
        fn(frame);
      } catch {
        /* listener */
      }
    }
  }

  async waitForSidecarReady(timeoutMs = 90_000) {
    if (this.sidecarReady) return;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.sidecarReady) return;
      await sleep(200);
    }
    throw new Error("sidecar_ready not received");
  }

  /**
   * @param {string} command
   * @param {object} data
   * @param {number} [timeoutMs]
   */
  async sendCommand(command, data, timeoutMs = 120_000) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.ensureConnected();
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        if (attempt === 0) {
          await this.reconnectFromHandshake();
          continue;
        }
        throw new Error("WebSocket not connected");
      }
      const id = `mkt-${++this.cmdSeq}-${Date.now()}`;
      const frame = { v: PROTOCOL_VERSION, t: "cmd", id, command, data };
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`Command timed out: ${command}`));
          }, timeoutMs);
          this.pending.set(id, {
            timer,
            resolve,
            reject: (e) => {
              clearTimeout(timer);
              reject(e);
            },
          });
          this.ws.send(JSON.stringify(frame));
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0 && /WebSocket closed|not connected/i.test(msg)) {
          await this.reconnectFromHandshake();
          continue;
        }
        throw err;
      }
    }
    throw new Error("WebSocket not connected");
  }

  isChatBusy(chatId) {
    if (this.runningChats.has(chatId)) return true;
    const chat = this.chats.find((c) => c.chatId === chatId);
    return chat?.busy ?? false;
  }

  sawHarnessRunning(chatId) {
    return this.runningChats.has(chatId) || this.turnEndedChats.has(chatId);
  }

  async waitForTurnEnd(chatId, maxWaitMs) {
    const start = Date.now();
    let sawRunning = false;
    while (Date.now() - start < maxWaitMs) {
      if (this.runningChats.has(chatId)) sawRunning = true;
      if (this.turnEndedChats.has(chatId) && sawRunning) return;
      await sleep(1500);
    }
    throw new Error(`turn_end not received for ${chatId} within ${maxWaitMs}ms`);
  }

  async ensureBootstrapSkipped(chatId) {
    const chat = this.chats.find((c) => c.chatId === chatId);
    if (!chat?.awaitingPersonaBootstrap) {
      const cfg = (await this.sendCommand("get_config", {})).data ?? {};
      if (!cfg.personaBootstrapPending) return;
    }
    console.log("[desktop] Skipping persona bootstrap…");
    await this.sendCommand("submit_persona_bootstrap", {
      chatId,
      input: "",
      skip: true,
    });
    await sleep(2500);
  }

  /** @returns {string | null} */
  findBatchChat() {
    const row = this.chats.find((c) => c.title === BATCH_CHAT_TITLE);
    return row?.chatId ?? null;
  }

  /**
   * @param {{ id: string }} spec
   * @param {string} repoRoot
   * @param {string | null} [batchChatId]
   */
  async resolveMarketingChat(spec, repoRoot, batchChatId = null) {
    if (REUSE_CHAT && batchChatId) {
      await this.prepareMarketingChat(batchChatId);
      return batchChatId;
    }

    const title = REUSE_CHAT ? BATCH_CHAT_TITLE : `marketing-${spec.id}`;
    const result = await this.sendCommand("create_chat", {
      title,
      workspaceRoot: repoRoot,
    });
    if (!result.ok) {
      throw new Error(result.error ?? "create_chat failed");
    }
    const chatId = result.data?.chatId;
    if (!chatId) throw new Error("create_chat returned no chatId");
    await this.prepareMarketingChat(chatId);
    return chatId;
  }

  /** Fresh chat for capture — no transcript replay (avoids stale "tools done" UI). */
  async prepareMarketingChat(chatId) {
    await this.sendCommand("open_chat", { chatId });
    const activated = await this.sendCommand("activate_chat", { chatId });
    if (!activated.ok) throw new Error(activated.error ?? "activate_chat failed");
    if (activated.data?.activeChatId) {
      this.activeChatId = activated.data.activeChatId;
    } else {
      this.activeChatId = chatId;
    }
    await this.sendCommand("reset_session", { chatId });
    this.runningChats.delete(chatId);
    this.turnEndedChats.delete(chatId);
    await this.waitHarnessIdle(120_000, chatId);
  }

  async purgeStaleMarketingChats() {
    const stale = this.chats.filter(
      (c) => c.title?.startsWith("marketing-") || c.title === BATCH_CHAT_TITLE
    );
    for (const chat of stale) {
      console.log(`[desktop] Removing stale marketing chat ${chat.chatId} (${chat.title})`);
      await this.sendCommand("delete_chat", { chatId: chat.chatId });
    }
  }

  /**
   * @param {{ id: string; prompt: string }} spec
   * @param {string} repoRoot
   * @deprecated Use resolveMarketingChat
   */
  async createMarketingChat(spec, repoRoot) {
    return this.resolveMarketingChat(spec, repoRoot, null);
  }

  async activateChat(chatId) {
    const result = await this.sendCommand("activate_chat", { chatId });
    if (!result.ok) throw new Error(result.error ?? "activate_chat failed");
    if (result.data?.activeChatId) this.activeChatId = result.data.activeChatId;
    await this.waitHarnessIdle(120_000, chatId);
  }

  async waitHarnessIdle(maxWaitMs, chatId = null) {
    const start = Date.now();
    let idleStreak = 0;
    while (Date.now() - start < maxWaitMs) {
      if (chatId && this.activeChatId !== chatId) {
        idleStreak = 0;
        await sleep(1000);
        continue;
      }
      const busy = chatId ? this.isChatBusy(chatId) : this.chats.some((c) => c.busy);
      if (!busy) {
        idleStreak++;
        if (idleStreak >= 3) return;
      } else {
        idleStreak = 0;
      }
      await sleep(2000);
    }
    throw new Error(
      `Harness still busy after ${maxWaitMs}ms` + (chatId ? ` (chat ${chatId})` : "")
    );
  }

  async waitForHarnessRunning(chatId, maxWaitMs = 90_000) {
    if (this.runningChats.has(chatId)) return;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (this.runningChats.has(chatId)) return;
      await sleep(200);
    }
    throw new Error(`harness_running not received for ${chatId} within ${maxWaitMs}ms`);
  }

  async postMessageWhenIdle(chatId, message, maxWaitMs = 120_000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const busy = this.isChatBusy(chatId);
      if (!busy) {
        const result = await this.sendCommand("send_message", {
          chatId,
          message,
          freshContext: true,
        });
        if (result.ok) {
          await this.waitForHarnessRunning(chatId, Math.min(90_000, maxWaitMs));
          return;
        }
        const msg = result.error ?? "";
        if (!/busy|processing/i.test(msg)) {
          throw new Error(result.error ?? "send_message failed");
        }
      }
      await sleep(1500);
    }
    throw new Error(`Could not post message for ${chatId} within ${maxWaitMs}ms`);
  }

  /** Auto-approve destructive tool gates during capture. */
  wireAutoApprove(chatId) {
    return this.onEvent(async (frame) => {
      if (frame.event !== "tool_approval" || frame.chatId !== chatId) return;
      const data = frame.data ?? {};
      const callId = data.callId;
      const approvalNonce = data.approvalNonce;
      if (!callId || !approvalNonce) return;
      console.log("[desktop] Auto-approving tool gate…");
      try {
        await this.sendCommand("resolve_approval", {
          chatId,
          callId,
          approvalNonce,
          decision: { decision: "approve" },
        });
      } catch (err) {
        console.warn(
          "[desktop] Auto-approve failed:",
          err instanceof Error ? err.message : err
        );
      }
    });
  }

  close() {
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {
        /* already closed */
      }
    }
    this.ws = null;
    this.sidecarReady = false;
    this.#rejectPending(new Error("WebSocket closed"));
  }
}

export { waitForFreshHandshake, waitForHandshake } from "./marketing-sidecar.mjs";
