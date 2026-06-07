import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  serverFrame,
  parseFrame,
  type ClientFrame,
  type ServerFrame,
  type ChatSummary,
} from "@liminal/protocol";
import { ChatRegistry } from "./chat_registry.js";
import {
  buildDesktopConfig,
  buildSettingsSnapshot,
  patchHarnessSettings,
  saveProviderCredentials,
  wireAppConfig,
} from "./sidecar_api.js";
import {
  buildVireonAccountSnapshot,
  vireonSignIn,
  vireonSignOut,
  wireVireonAccountPayload,
} from "./vireon_api.js";
import {
  liminalAppsEnabled,
  loadChatTranscriptFromSessionLog,
  slimReplayEntriesForWire,
  type ProviderConfig,
  type RuntimePreferences,
} from "@liminal/core";
import { tryHandleAudioRequest } from "./audio_http.js";
import { tryHandleBrowserPreviewRequest } from "./browser_preview_handler.js";
import { tryHandleAppProxyRequest } from "./app_proxy_handler.js";
import { tryHandleAppHtmlRequest } from "./app_html_handler.js";
import { tryHandleMediaRequest } from "./media_handler.js";
import { getBrowserPanelFrame } from "@liminal/tools";
import { buildOutboundUserMessage, normalizeWireAttachments } from "./message_attachments.js";
import { LiminalAppManager } from "./app_manager.js";

const SIDECAR_VERSION = "0.1.0";

export interface WsServerOptions {
  token: string;
  provider: ProviderConfig;
  runtimePreferences: RuntimePreferences | null;
  repoRoot: string;
}

/**
 * The WebSocket transport for `liminald`.
 *
 * Binds to 127.0.0.1 only, gates every connection on the per-launch token, and
 * fans harness frames out to all attached UI sockets. Inbound command frames
 * are dispatched against the {@link ChatRegistry} and acknowledged with a
 * `command_result` event correlated by the command's `id`.
 */
export class WsServer {
  private readonly http: HttpServer;
  private readonly wss: WebSocketServer;
  private readonly clients = new Set<WebSocket>();
  private readonly registry: ChatRegistry;
  private readonly appManager: LiminalAppManager;
  private readonly token: string;
  private readonly repoRoot: string;

  constructor(opts: WsServerOptions) {
    this.token = opts.token;
    this.repoRoot = opts.repoRoot;
    this.appManager = new LiminalAppManager((frame) => this.broadcast(frame));
    this.registry = new ChatRegistry({
      provider: opts.provider,
      runtimePreferences: opts.runtimePreferences,
      repoRoot: opts.repoRoot,
      sink: (frame) => this.broadcast(frame),
      registerToolsDeps: { appManager: this.appManager },
    });

    this.http = createServer((req, res) => {
      if (
        liminalAppsEnabled() &&
        tryHandleAppHtmlRequest(req, res, {
          token: this.token,
        })
      ) {
        return;
      }
      if (
        liminalAppsEnabled() &&
        tryHandleAppProxyRequest(req, res, {
          token: this.token,
        })
      ) {
        return;
      }
      if (
        tryHandleBrowserPreviewRequest(req, res, {
          token: this.token,
          resolveFrame: (sessionId) => getBrowserPanelFrame(sessionId),
        })
      ) {
        return;
      }
      if (
        tryHandleMediaRequest(req, res, {
          token: this.token,
          resolveWorkspaceRoot: (chatId) => this.registry.resolveWorkspaceForMedia(chatId),
        })
      ) {
        return;
      }
      if (
        tryHandleAudioRequest(req, res, {
          token: this.token,
          resolveBridge: (chatId) => this.registry.resolveBridgeForAudio(chatId),
        })
      ) {
        return;
      }
      res.writeHead(404);
      res.end();
    });
    this.wss = new WebSocketServer({ noServer: true });

    // Authenticate at the HTTP upgrade so an unauthorized peer never gets a
    // WebSocket at all. Token may arrive as `?token=` or the `sec-websocket-protocol` header.
    this.http.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const headerToken = (req.headers["sec-websocket-protocol"] as string | undefined)?.trim();
      const queryToken = url.searchParams.get("token") ?? undefined;
      const presented = queryToken ?? headerToken;
      if (presented !== this.token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    });
  }

  /** Start listening on an ephemeral 127.0.0.1 port; resolves with the chosen port. */
  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.http.once("error", reject);
      this.http.listen(0, "127.0.0.1", () => {
        if (liminalAppsEnabled()) {
          this.appManager.startRefreshLoop();
        }
        const addr = this.http.address();
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("Failed to resolve sidecar port."));
      });
    });
  }

  private broadcast(frame: ServerFrame): void {
    const payload = JSON.stringify(frame);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  private sendTo(ws: WebSocket, frame: ServerFrame): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }

  private chatList(): { chats: ChatSummary[]; activeChatId: string } {
    return {
      chats: this.registry.list(),
      activeChatId: this.registry.activeId ?? "",
    };
  }

  private async onConnection(ws: WebSocket): Promise<void> {
    this.clients.add(ws);

    // Attach the command handler immediately. Cold start (tool registration) can
    // take 10–30s; frames that arrive before we finish must be queued, not dropped.
    const pending: ClientFrame[] = [];
    let acceptCommands = false;

    ws.on("message", (raw) => {
      const frame = parseFrame(raw.toString());
      if (!frame || frame.t !== "cmd") return;
      if (!acceptCommands) {
        pending.push(frame);
        return;
      }
      void this.dispatch(ws, frame);
    });
    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", () => this.clients.delete(ws));

    acceptCommands = true;
    for (const frame of pending) {
      void this.dispatch(ws, frame);
    }

    // Let the UI connect immediately; full harness init can take 30–60s on cold start.
    this.sendTo(
      ws,
      serverFrame("hello", {
        protocolVersion: PROTOCOL_VERSION,
        sidecarVersion: SIDECAR_VERSION,
        activeChatId: "",
        chats: [],
        starting: true,
      })
    );

    const INIT_TIMEOUT_MS = 120_000;
    let initError: string | undefined;
    let bridge: Awaited<ReturnType<typeof this.registry.getOrCreateActive>> | undefined;
    try {
      bridge = await Promise.race([
        this.registry.getOrCreateActive(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Harness init timed out after ${INIT_TIMEOUT_MS / 1000}s`)),
            INIT_TIMEOUT_MS
          )
        ),
      ]);
    } catch (err) {
      initError = err instanceof Error ? err.message : String(err);
      bridge = undefined;
    }

    let appConfig: Awaited<ReturnType<typeof buildDesktopConfig>> | undefined;
    if (bridge) {
      try {
        appConfig = await buildDesktopConfig(bridge, this.repoRoot);
      } catch (err) {
        initError = initError ?? (err instanceof Error ? err.message : String(err));
        appConfig = undefined;
      }
    }

    this.sendTo(
      ws,
      serverFrame("sidecar_ready", {
        activeChatId: this.registry.activeId ?? "",
        chats: this.registry.list(),
        ...(appConfig ? { appConfig: wireAppConfig(appConfig) } : {}),
        ...(initError ? { initError } : {}),
      })
    );

    if (liminalAppsEnabled()) {
      void this.appManager.broadcastAppList();
    }

    const activeId = this.registry.activeId;
    if (activeId) {
      await this.unicastTranscriptReplay(ws, activeId);
    }
  }

  /** Guaranteed delivery to the socket that just finished cold start. */
  private async unicastTranscriptReplay(ws: WebSocket, chatId: string): Promise<void> {
    const entries = await loadChatTranscriptFromSessionLog(chatId);
    if (entries.length === 0) return;
    this.sendTo(
      ws,
      serverFrame(
        "transcript_replay",
        { chatId, entries: slimReplayEntriesForWire(entries) },
        chatId
      )
    );
  }

  /** Acknowledge a command back to the originating socket. */
  private ack(ws: WebSocket, commandId: string, ok: boolean, error?: string, data?: unknown): void {
    this.sendTo(ws, serverFrame("command_result", { commandId, ok, ...(error ? { error } : {}), ...(data !== undefined ? { data } : {}) }));
  }

  /** Push the current chat list to every client (after create/delete/activate). */
  private broadcastChatList(): void {
    this.broadcast(serverFrame("chat_list", this.chatList()));
  }

  private async dispatch(ws: WebSocket, frame: ClientFrame): Promise<void> {
    const { id, command, data } = frame;
    try {
      switch (command) {
        case "ping":
          this.sendTo(ws, serverFrame("pong", { at: Date.now() }));
          this.ack(ws, id, true);
          return;

        case "list_chats":
          this.sendTo(ws, serverFrame("chat_list", this.chatList()));
          this.ack(ws, id, true);
          return;

        case "create_chat": {
          const d = data as { workspaceRoot?: string; title?: string };
          const bridge = await this.registry.create(d);
          this.broadcastChatList();
          this.ack(ws, id, true, undefined, { chatId: bridge.chatId });
          return;
        }

        case "activate_chat": {
          const d = data as { chatId: string };
          const ok = await this.registry.activate(d.chatId);
          if (ok) this.broadcastChatList();
          this.ack(ws, id, ok, ok ? undefined : "Unknown chatId.");
          return;
        }

        case "delete_chat": {
          const d = data as { chatId: string };
          const newActive = await this.registry.delete(d.chatId);
          this.broadcastChatList();
          this.ack(ws, id, true, undefined, { activeChatId: newActive });
          return;
        }

        case "replay_transcript": {
          const d = data as { chatId: string };
          const bridge = this.registry.get(d.chatId);
          if (!bridge) {
            const ok = await this.registry.activate(d.chatId);
            if (!ok) return this.ack(ws, id, false, "Unknown chatId.");
          }
          const active = this.registry.get(d.chatId);
          if (!active) return this.ack(ws, id, false, "Unknown chatId.");
          await active.replayPersistedTranscript({ uiOnly: true });
          this.ack(ws, id, true);
          return;
        }

        case "send_message": {
          const d = data as {
            chatId: string;
            message: string;
            freshContext?: boolean;
            liveDictation?: boolean;
            attachments?: import("@liminal/protocol").WireImageAttachment[];
          };
          const bridge = this.registry.get(d.chatId);
          if (!bridge) return this.ack(ws, id, false, "Unknown chatId.");
          const msg = String(d.message ?? "").trim();
          const att = normalizeWireAttachments(d.attachments);
          if (!att.ok) return this.ack(ws, id, false, att.error);
          if (!msg && att.attachments.length === 0) {
            return this.ack(ws, id, false, "message or attachments required");
          }
          const outbound = buildOutboundUserMessage(msg, att.attachments);
          this.registry.touch(d.chatId, msg.slice(0, 60) || "Image attachment");
          this.broadcastChatList();
          this.ack(ws, id, true);
          bridge
            .sendUserMessage(outbound, {
              freshContext: d.freshContext,
              liveDictation: d.liveDictation,
            })
            .catch((err) => {
              this.broadcast(
                serverFrame("error", { message: err instanceof Error ? err.message : String(err) }, d.chatId)
              );
            });
          return;
        }

        case "abort": {
          const d = data as { chatId: string };
          const bridge = this.registry.get(d.chatId);
          const ok = bridge?.abort() ?? false;
          this.ack(ws, id, ok, ok ? undefined : "No turn in progress.");
          return;
        }

        case "resolve_approval": {
          const d = data as { chatId: string; callId: string; approvalNonce: string; decision: import("@liminal/core").ApprovalDecision };
          const bridge = this.registry.get(d.chatId);
          const ok = bridge?.resolveApproval(d.callId, d.decision, d.approvalNonce) ?? false;
          this.ack(ws, id, ok, ok ? undefined : "No matching approval (stale or wrong nonce).");
          return;
        }

        case "resolve_ask_user": {
          const d = data as { chatId: string; answer: string };
          const bridge = this.registry.get(d.chatId);
          const ok = bridge?.resolveAskUser(d.answer) ?? false;
          this.ack(ws, id, ok, ok ? undefined : "No ask_user outstanding.");
          return;
        }

        case "reset_session": {
          const d = data as { chatId: string; greet?: boolean; rebootstrap?: boolean };
          const bridge = this.registry.get(d.chatId);
          if (!bridge) return this.ack(ws, id, false, "Unknown chatId.");
          if (d.rebootstrap) {
            try {
              await bridge.resetPersonaBootstrapForSession();
            } catch (err) {
              return this.ack(
                ws,
                id,
                false,
                err instanceof Error ? err.message : "Persona rebootstrap failed."
              );
            }
          } else {
            bridge.clearSession();
          }
          this.ack(ws, id, true, undefined, {
            awaitingPersonaBootstrap: bridge.isAwaitingPersonaBootstrap,
          });
          if (d.greet && !bridge.isAwaitingPersonaBootstrap) {
            bridge.greet().catch(() => undefined);
          }
          return;
        }

        case "get_config": {
          const bridge = await this.registry.getOrCreateActive();
          const config = await buildDesktopConfig(bridge, this.repoRoot);
          this.ack(ws, id, true, undefined, wireAppConfig(config));
          return;
        }

        case "get_settings": {
          const bridge = this.registry.getActiveBridge() ?? (await this.registry.getOrCreateActive());
          const snapshot = buildSettingsSnapshot(bridge.harness.getRuntimePreferences(), bridge);
          this.sendTo(ws, serverFrame("settings", { values: snapshot }));
          this.ack(ws, id, true, undefined, snapshot);
          return;
        }

        case "update_settings": {
          const d = data as { patch: Record<string, unknown> };
          await patchHarnessSettings(this.registry, d.patch ?? {});
          const bridge = this.registry.getActiveBridge();
          const snapshot = buildSettingsSnapshot(
            bridge?.harness.getRuntimePreferences() ?? null,
            bridge
          );
          this.broadcast(serverFrame("settings", { values: snapshot }));
          this.broadcastChatList();
          this.ack(ws, id, true);
          return;
        }

        case "save_provider": {
          const d = data as { apiKey?: string; model?: string; baseURL?: string };
          await saveProviderCredentials(this.registry, this.repoRoot, d);
          const bridge = await this.registry.getOrCreateActive();
          const config = await buildDesktopConfig(bridge, this.repoRoot);
          this.broadcastChatList();
          this.ack(ws, id, true, undefined, wireAppConfig(config));
          return;
        }

        case "submit_persona_bootstrap": {
          const d = data as { chatId: string; input: string; skip?: boolean };
          const bridge = this.registry.get(d.chatId);
          if (!bridge) return this.ack(ws, id, false, "Unknown chatId.");
          await bridge.submitPersonaBootstrap(d.input, { skip: d.skip });
          this.broadcastChatList();
          const config = await buildDesktopConfig(bridge, this.repoRoot);
          this.ack(ws, id, true, undefined, wireAppConfig(config));
          return;
        }

        case "get_vireon_account": {
          const snapshot = await buildVireonAccountSnapshot();
          const wire = wireVireonAccountPayload(snapshot);
          this.sendTo(ws, serverFrame("vireon_account", wire));
          this.ack(ws, id, true, undefined, wire);
          return;
        }

        case "vireon_sign_in": {
          const d = data as { openBrowser?: boolean };
          const snapshot = await vireonSignIn(this.registry, {
            openBrowser: d.openBrowser !== false,
          });
          const wire = wireVireonAccountPayload(snapshot);
          this.broadcast(serverFrame("vireon_account", wire));
          this.broadcastChatList();
          const bridge = this.registry.getActiveBridge() ?? (await this.registry.getOrCreateActive());
          const config = await buildDesktopConfig(bridge, this.repoRoot);
          this.ack(ws, id, true, undefined, { ...wire, appConfig: wireAppConfig(config) });
          return;
        }

        case "vireon_sign_out": {
          const snapshot = await vireonSignOut(this.registry);
          const wire = wireVireonAccountPayload(snapshot);
          this.broadcast(serverFrame("vireon_account", wire));
          this.broadcastChatList();
          this.ack(ws, id, true, undefined, wire);
          return;
        }

        case "list_apps": {
          if (!liminalAppsEnabled()) {
            return this.ack(ws, id, false, "Liminal desktop apps are disabled (AGENT_LIMINAL_APPS=0).");
          }
          const payload = await this.appManager.listAppsWithCaches();
          this.sendTo(ws, serverFrame("app_list", payload));
          this.ack(ws, id, true, undefined, payload);
          return;
        }

        case "open_app_window": {
          if (!liminalAppsEnabled()) {
            return this.ack(ws, id, false, "Liminal desktop apps are disabled (AGENT_LIMINAL_APPS=0).");
          }
          const d = data as { appId: string };
          const app = (await this.appManager.listApps()).find((a) => a.id === d.appId);
          if (!app) return this.ack(ws, id, false, "Unknown appId.");
          this.broadcast(serverFrame("app_spawned", { app }));
          this.ack(ws, id, true);
          return;
        }

        case "refresh_app": {
          if (!liminalAppsEnabled()) {
            return this.ack(ws, id, false, "Liminal desktop apps are disabled (AGENT_LIMINAL_APPS=0).");
          }
          const d = data as { appId: string };
          try {
            const cache = await this.appManager.refreshApp(d.appId);
            this.ack(ws, id, true, undefined, { cache });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "remove_app": {
          if (!liminalAppsEnabled()) {
            return this.ack(ws, id, false, "Liminal desktop apps are disabled (AGENT_LIMINAL_APPS=0).");
          }
          const d = data as { appId: string };
          const ok = await this.appManager.closeApp(d.appId);
          this.ack(ws, id, ok, ok ? undefined : "Unknown appId.");
          return;
        }

        case "update_app": {
          if (!liminalAppsEnabled()) {
            return this.ack(ws, id, false, "Liminal desktop apps are disabled (AGENT_LIMINAL_APPS=0).");
          }
          const d = data as {
            appId: string;
            title?: string;
            props?: Record<string, unknown>;
            refresh?: { interval_min: number };
            auto_open?: boolean;
          };
          try {
            const app = await this.appManager.updateApp(d.appId, {
              title: d.title,
              props: d.props,
              refresh: d.refresh,
              auto_open: d.auto_open,
            });
            this.ack(ws, id, true, undefined, { app });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        default:
          this.ack(ws, id, false, `Unknown command "${String(command)}".`);
          return;
      }
    } catch (err) {
      this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
    }
  }

  /** Graceful teardown. */
  close(): void {
    for (const ws of this.clients) {
      try {
        ws.close(1001, "sidecar_shutdown");
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    this.appManager.stopRefreshLoop();
    this.registry.disposeAll();
    this.wss.close();
    this.http.close();
  }
}
