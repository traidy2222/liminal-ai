import type { Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  formatRemoteEnableMessage,
  formatRemoteStatusMessage,
  loadChatTranscriptFromSessionLog,
  remoteCommandAllowed,
  slimReplayEntriesForWire,
  type RemoteSessionStatus,
} from "@liminal/core";
import { RemoteHostManager } from "@liminal/sidecar/remote_host";
import {
  CloudRelayForwarder,
  registerCloudRemoteSession,
} from "@liminal/sidecar/remote_cloud";
import type { ApprovalDecision } from "@liminal/core";
import type { ChatManager } from "./chatManager.js";
import type { SSEManager } from "./sse.js";

type GuestMeta = { role: "view" | "control"; chatId: string };

export class WebRemoteService {
  private readonly remoteHost: RemoteHostManager;
  private readonly guests = new Map<WebSocket, GuestMeta>();
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly cloudRelay = new CloudRelayForwarder();
  private sseTapInstalled = false;

  constructor(
    private readonly chatManager: ChatManager,
    private readonly sse: SSEManager
  ) {
    this.remoteHost = new RemoteHostManager((status) => this.onRemoteStatus(status));
  }

  setPrimaryPort(port: number): void {
    this.remoteHost.setPrimaryPort(port);
    this.remoteHost.setLanUpgradeHandler((req, socket, head) => {
      this.handleUpgrade(req, socket, head);
    });
  }

  attach(server: Server): void {
    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/remote/ws") {
        this.handleUpgrade(req, socket, head);
      }
    });
    this.installSseTap();
  }

  handleHttp(req: IncomingMessage, res: ServerResponse): boolean {
    return this.remoteHost.handleLanHttp(req, res);
  }

  async enable(opts: {
    chatId: string;
    mode: "view" | "control";
    cloud?: boolean;
  }): Promise<Record<string, unknown>> {
    await this.chatManager.activate(opts.chatId, { announce: false });
    let cloudUrl: string | null = null;
    const result = await this.remoteHost.enable({
      chatId: opts.chatId,
      mode: opts.mode,
      cloud: opts.cloud,
    });
    if (opts.cloud) {
      const cloud = await registerCloudRemoteSession({
        chatId: opts.chatId,
        mode: opts.mode,
        joinCode: result.joinCode,
        joinToken: result.joinToken,
      });
      if (!cloud) {
        throw new Error("Cloud remote requires Vireon Pro sign-in (pro.remote_sessions).");
      }
      cloudUrl = cloud.cloudUrl;
      result.cloudUrl = cloud.cloudUrl;
      this.cloudRelay.setRelay({
        relayHostUrl: cloud.relayHostUrl,
        joinCode: cloud.joinCode,
        joinToken: result.joinToken,
      });
    } else {
      this.cloudRelay.clear();
    }
    return {
      joinCode: result.joinCode,
      lanUrl: result.lanUrl,
      cloudUrl,
      expiresAt: result.expiresAt,
      mode: opts.mode,
      message: formatRemoteEnableMessage({
        joinCode: result.joinCode,
        lanUrl: result.lanUrl,
        cloudUrl,
        expiresAt: result.expiresAt,
        mode: opts.mode,
      }),
    };
  }

  disable(chatId?: string): { removed: number; message: string } {
    const removed = this.remoteHost.disable(chatId);
    this.cloudRelay.clear();
    return {
      removed,
      message: removed > 0 ? "Remote access revoked." : "No active remote session.",
    };
  }

  status(chatId?: string): RemoteSessionStatus & { message: string } {
    const status = this.remoteHost.status(chatId);
    return { ...status, message: formatRemoteStatusMessage(status) };
  }

  revoke(joinCode: string): { ok: boolean; message: string } {
    const ok = this.remoteHost.revokeCode(joinCode);
    return {
      ok,
      message: ok ? `Revoked join code ${joinCode}.` : "Unknown join code.",
    };
  }

  private onRemoteStatus(_status: RemoteSessionStatus): void {
    /* web UI can poll /api/remote/status */
  }

  private handleUpgrade(
    req: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer
  ): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const joinToken = url.searchParams.get("join")?.trim();
    if (!joinToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const resolved = this.remoteHost.resolveJoinToken(joinToken);
    if (!resolved || (resolved.role !== "view" && resolved.role !== "control")) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const guestRole = resolved.role as "view" | "control";
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.onGuestConnection(ws, { role: guestRole, chatId: resolved.chatId });
    });
  }

  private async onGuestConnection(
    ws: WebSocket,
    meta: { role: "view" | "control"; chatId: string }
  ): Promise<void> {
    this.guests.set(ws, meta);
    this.remoteHost.attachGuest(ws);
    ws.on("close", () => {
      this.guests.delete(ws);
      this.remoteHost.detachGuest(ws);
    });
    ws.on("message", (raw) => {
      void this.handleGuestCommand(ws, raw.toString());
    });

    ws.send(
      JSON.stringify({
        t: "evt",
        v: 1,
        e: "hello",
        p: { clientRole: meta.role, activeChatId: meta.chatId },
      })
    );

    const entries = await loadChatTranscriptFromSessionLog(meta.chatId);
    if (entries.length > 0) {
      ws.send(
        JSON.stringify({
          t: "evt",
          v: 1,
          e: "transcript_replay",
          chatId: meta.chatId,
          p: { chatId: meta.chatId, entries: slimReplayEntriesForWire(entries) },
        })
      );
    }
  }

  private async handleGuestCommand(ws: WebSocket, raw: string): Promise<void> {
    const meta = this.guests.get(ws);
    if (!meta) return;
    let frame: { id?: string; command?: string; data?: Record<string, unknown> };
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      return;
    }
    const command = frame.command ?? "";
    const id = frame.id ?? "guest";
    if (!remoteCommandAllowed(meta.role, command)) {
      ws.send(
        JSON.stringify({
          t: "evt",
          v: 1,
          e: "command_result",
          p: { commandId: id, ok: false, error: `Not allowed for ${meta.role}` },
        })
      );
      return;
    }
    if (this.chatManager.activeId !== meta.chatId) {
      await this.chatManager.activate(meta.chatId, { announce: false });
    }
    let bridge;
    try {
      bridge = this.chatManager.getActive();
    } catch {
      bridge = null;
    }
    if (!bridge || bridge.chatId !== meta.chatId) {
      ws.send(
        JSON.stringify({
          t: "evt",
          v: 1,
          e: "command_result",
          p: { commandId: id, ok: false, error: "Unknown chat" },
        })
      );
      return;
    }
    if (command === "send_message") {
      const message = String(frame.data?.message ?? "").trim();
      if (!message) return;
      ws.send(
        JSON.stringify({
          t: "evt",
          v: 1,
          e: "command_result",
          p: { commandId: id, ok: true },
        })
      );
      void bridge.sendUserMessage(message);
      return;
    }
    if (command === "abort") {
      const ok = bridge.harness.getIsRunning();
      if (ok) bridge.harness.abortCurrentTurn();
      ws.send(
        JSON.stringify({
          t: "evt",
          v: 1,
          e: "command_result",
          p: { commandId: id, ok, ...(ok ? {} : { error: "No turn in progress." }) },
        })
      );
      return;
    }
    if (command === "resolve_approval") {
      const callId = String(frame.data?.callId ?? "");
      const approvalNonce = String(frame.data?.approvalNonce ?? "");
      const decision = frame.data?.decision as ApprovalDecision;
      const ok = bridge.resolveApproval(callId, decision, approvalNonce);
      ws.send(
        JSON.stringify({
          t: "evt",
          v: 1,
          e: "command_result",
          p: {
            commandId: id,
            ok,
            ...(ok ? {} : { error: "No matching approval." }),
          },
        })
      );
      return;
    }
    if (command === "resolve_ask_user") {
      const answer = String(frame.data?.answer ?? "");
      const ok = bridge.resolveAskUser(answer);
      ws.send(
        JSON.stringify({
          t: "evt",
          v: 1,
          e: "command_result",
          p: {
            commandId: id,
            ok,
            ...(ok ? {} : { error: "No ask_user outstanding." }),
          },
        })
      );
      return;
    }
    if (command === "ping") {
      ws.send(
        JSON.stringify({
          t: "evt",
          v: 1,
          e: "pong",
          p: { at: Date.now() },
        })
      );
      ws.send(
        JSON.stringify({
          t: "evt",
          v: 1,
          e: "command_result",
          p: { commandId: id, ok: true },
        })
      );
    }
  }

  private installSseTap(): void {
    if (this.sseTapInstalled) return;
    this.sseTapInstalled = true;
    const original = this.sse.send.bind(this.sse);
    this.sse.send = (eventName: string, data: unknown, chatId: string) => {
      original(eventName, data, chatId);
      const payload = JSON.stringify({
        t: "evt",
        v: 1,
        e: eventName,
        chatId,
        p: data,
      });
      this.cloudRelay.forward(payload);
      for (const [ws, meta] of this.guests) {
        if (meta.chatId !== chatId) continue;
        if (ws.readyState === WebSocket.OPEN) ws.send(payload);
      }
    };
  }

  dispose(): void {
    this.remoteHost.dispose();
    this.wss.close();
  }
}
