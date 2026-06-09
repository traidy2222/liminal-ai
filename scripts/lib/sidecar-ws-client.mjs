/**
 * Token-gated loopback WebSocket client for `liminald` — drives real harness turns
 * during desktop marketing capture (no HTTP /api shim).
 */
const PROTOCOL_VERSION = 1;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class SidecarWsClient {
  /**
   * @param {number} port
   * @param {string} token
   */
  constructor(port, token) {
    this.port = port;
    this.token = token;
    /** @type {WebSocket | null} */
    this.ws = null;
    /** @type {Map<string, { resolve: (v: object) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    this.cmdSeq = 0;
    /** @type {{ chatId: string; busy: boolean }[]} */
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
  }

  onEvent(fn) {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  async connect(timeoutMs = 30_000) {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    const url = `ws://127.0.0.1:${this.port}?token=${encodeURIComponent(this.token)}`;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`WS connect timeout: ${url}`)), timeoutMs);
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`WebSocket error: ${url}`));
      });
      ws.addEventListener("message", (ev) => this.#onMessage(String(ev.data)));
      ws.addEventListener("close", () => {
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error("WebSocket closed"));
        }
        this.pending.clear();
      });
    });
    await this.waitForSidecarReady(90_000);
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    const id = `mkt-${++this.cmdSeq}-${Date.now()}`;
    const frame = { v: PROTOCOL_VERSION, t: "cmd", id, command, data };
    return new Promise((resolve, reject) => {
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

  /**
   * @param {{ id: string; prompt: string }} spec
   * @param {string} repoRoot
   */
  async createMarketingChat(spec, repoRoot) {
    const result = await this.sendCommand("create_chat", {
      title: `marketing-${spec.id}`,
      workspaceRoot: repoRoot,
    });
    if (!result.ok) {
      throw new Error(result.error ?? "create_chat failed");
    }
    const chatId = result.data?.chatId;
    if (!chatId) throw new Error("create_chat returned no chatId");
    await this.activateChat(chatId);
    await this.sendCommand("open_chat", { chatId });
    await this.sendCommand("replay_transcript", { chatId });
    return chatId;
  }

  async activateChat(chatId) {
    const result = await this.sendCommand("activate_chat", { chatId });
    if (!result.ok) throw new Error(result.error ?? "activate_chat failed");
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

  async postMessageWhenIdle(chatId, message, maxWaitMs = 120_000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await this.activateChat(chatId);
      const result = await this.sendCommand("send_message", {
        chatId,
        message,
        freshContext: true,
      });
      if (result.ok) return;
      const msg = result.error ?? "";
      if (!/busy|processing/i.test(msg)) {
        throw new Error(result.error ?? "send_message failed");
      }
      await sleep(2500);
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
      await this.sendCommand("resolve_approval", {
        chatId,
        callId,
        approvalNonce,
        decision: { decision: "approve" },
      });
    });
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}

/**
 * Poll `~/.liminal/sidecar.json` until present.
 * @param {number} [timeoutMs]
 */
export async function waitForHandshake(timeoutMs = 90_000) {
  const os = await import("node:os");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const home = process.env.LIMINAL_HOME?.trim() || path.join(os.homedir(), ".liminal");
  const file = path.join(home, "sidecar.json");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const text = await fs.readFile(file, "utf8");
      const json = JSON.parse(text);
      if (json.port && json.token) return json;
    } catch {
      /* mid-write */
    }
    await sleep(250);
  }
  throw new Error(`Handshake file not found: ${file}`);
}
