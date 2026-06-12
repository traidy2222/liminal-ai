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
  vireonReconnect,
  vireonSignIn,
  vireonSignOut,
  wireVireonAccountPayload,
} from "./vireon_api.js";
import {
  fetchManagedInferenceModels,
  liminalAppsEnabled,
  loadChatTranscriptFromSessionLog,
  remoteCommandAllowed,
  slimReplayEntriesForWire,
  type ProviderConfig,
  type RemoteSessionStatus,
  type RuntimePreferences,
} from "@liminal/core";
import { RemoteHostManager, type RemoteClientMeta } from "./remote_host.js";
import {
  CloudRelayForwarder,
  registerCloudRemoteSession,
} from "./remote_cloud_connector.js";
import { tryHandleAudioRequest } from "./audio_http.js";
import { tryHandleBrowserPreviewRequest } from "./browser_preview_handler.js";
import {
  tryHandleBrowserCookiesRequest,
  tryHandleBrowserNavigateRequest,
} from "./browser_sync_handler.js";
import { tryHandleAppProxyRequest } from "./app_proxy_handler.js";
import { tryHandleAppHtmlRequest } from "./app_html_handler.js";
import { tryHandleMediaRequest } from "./media_handler.js";
import { getBrowserPanelFrame, setTerminalViewPublisher } from "@liminal/tools";
import { buildPtyOpenedPayload, createSidecarEnsureTerminal } from "./pty_terminal.js";
import { createPtyShellPort } from "./pty_shell_port.js";
import { normalizeWireAttachments } from "./message_attachments.js";
import { LiminalAppManager } from "./app_manager.js";
import { ChatOrchestrator } from "./chat_orchestrator.js";
import { PtyManager } from "./pty_manager.js";
import { createPtyStreamServer, tryHandlePtyUpgrade } from "./pty_stream_handler.js";
import {
  createBrowserStreamServer,
  tryHandleBrowserStreamUpgrade,
} from "./browser_stream_handler.js";
import {
  clearRemoteUiStream,
  createRemoteUiStreamServer,
  publishRemoteUiFrame,
  tryHandleRemoteUiStreamUpgrade,
  type RemoteUiInput,
} from "./remote_ui_stream_handler.js";
import {
  tryHandleTerminalAssetRequest,
  tryHandleTerminalEmbedRequest,
  tryHandleTerminalResizeRequest,
} from "./terminal_embed_handler.js";
import {
  attachIntegrationMcp,
  buildIntegrationsSnapshot,
  connectGithub,
  connectGithubOAuth,
  connectGoogleOAuth,
  connectGoogleWorkspace,
  connectIntegrationOpenApi,
  detachIntegrationMcp,
  disconnectGithub,
  disconnectGoogle,
  disconnectMicrosoft,
  connectMicrosoftOAuth,
  connectMicrosoft365,
  connectAzureOAuth,
  connectAzure,
  disconnectAzure,
  connectXeroOAuth,
  disconnectXero,
  connectSlackOAuth,
  disconnectSlack,
  connectLinearOAuth,
  disconnectLinear,
  connectNotionOAuth,
  disconnectNotion,
  disconnectIntegrationOpenApi,
} from "./integrations_api.js";

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
  private readonly orchestrator: ChatOrchestrator;
  private readonly token: string;
  private readonly repoRoot: string;
  private readonly ptyManager = new PtyManager();
  private readonly ptyWss;
  private readonly browserWss;
  private readonly remoteUiWss;
  private readonly remoteHost: RemoteHostManager;
  private readonly cloudRelay = new CloudRelayForwarder();
  private readonly clientMeta = new Map<WebSocket, RemoteClientMeta>();

  constructor(opts: WsServerOptions) {
    this.token = opts.token;
    this.repoRoot = opts.repoRoot;
    this.appManager = new LiminalAppManager((frame) => this.broadcast(frame));
    const ensureTerminal = createSidecarEnsureTerminal({
      ptyManager: this.ptyManager,
      resolveWorkspaceRoot: (chatId) =>
        this.registry.resolveWorkspaceForMedia(chatId) ?? this.repoRoot,
      fallbackRoot: this.repoRoot,
    });
    const ptyShellPort = createPtyShellPort(
      this.ptyManager,
      ensureTerminal,
      (chatId) => this.registry.resolveWorkspaceForMedia(chatId) ?? this.repoRoot
    );
    this.registry = new ChatRegistry({
      provider: opts.provider,
      runtimePreferences: opts.runtimePreferences,
      repoRoot: opts.repoRoot,
      sink: (frame) => {
        this.orchestrator.handleFrame(frame);
        this.broadcast(frame);
      },
      registerToolsDeps: {
        appManager: this.appManager,
        ensureTerminal,
        ptyShellPort,
      },
    });
    this.orchestrator = new ChatOrchestrator({
      registry: this.registry,
      repoRoot: opts.repoRoot,
      provider: opts.provider,
      emit: (frame) => this.broadcast(frame),
    });
    this.registry.setOrchestrator(() => this.orchestrator);

    this.remoteHost = new RemoteHostManager((status) => this.broadcastRemoteSession(status));

    this.ptyWss = createPtyStreamServer({
      token: this.token,
      ptyManager: this.ptyManager,
    });
    this.browserWss = createBrowserStreamServer();
    this.remoteUiWss = createRemoteUiStreamServer();

    this.ptyManager.on("exit", (sessionId, chatId, exitCode) => {
      this.broadcast(
        serverFrame("pty_exit", { sessionId, chatId, exitCode }, chatId)
      );
    });

    setTerminalViewPublisher((payload) => {
      this.broadcast(serverFrame("terminal_view", payload, payload.chatId));
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
      if (tryHandleBrowserCookiesRequest(req, res, { token: this.token })) {
        return;
      }
      if (tryHandleBrowserNavigateRequest(req, res, { token: this.token })) {
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
      if (
        tryHandleTerminalAssetRequest(req, res, { token: this.token })
      ) {
        return;
      }
      if (
        tryHandleTerminalResizeRequest(req, res, {
          token: this.token,
          ptyManager: this.ptyManager,
        })
      ) {
        return;
      }
      if (tryHandleTerminalEmbedRequest(req, res, { token: this.token })) {
        return;
      }
      if (
        this.remoteHost.handleLanHttp(req, res)
      ) {
        return;
      }
      res.writeHead(404);
      res.end();
    });
    this.wss = new WebSocketServer({ noServer: true });

    this.http.on("upgrade", (req, socket, head) => {
      this.handleProtocolUpgrade(req, socket, head);
    });
    this.remoteHost.setLanUpgradeHandler((req, socket, head) => {
      this.handleProtocolUpgrade(req, socket, head, { lanOnly: true });
    });
  }

  private handleProtocolUpgrade(
    req: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
    opts?: { lanOnly?: boolean }
  ): void {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const headerToken = (req.headers["sec-websocket-protocol"] as string | undefined)?.trim();
    const queryToken = url.searchParams.get("token") ?? undefined;
    const joinToken = url.searchParams.get("join") ?? undefined;
    const presented = queryToken ?? headerToken;

    let meta: RemoteClientMeta = { role: "owner" };
    if (joinToken) {
      const resolved = this.remoteHost.resolveJoinToken(joinToken);
      if (!resolved) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      meta = { role: resolved.role, chatId: resolved.chatId };
    } else if (presented !== this.token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    } else if (opts?.lanOnly) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!joinToken) {
      if (
        tryHandlePtyUpgrade(req, socket, head, {
          token: this.token,
          ptyManager: this.ptyManager,
        }, this.ptyWss)
      ) {
        return;
      }
    } else if (meta.role === "control") {
      if (
        tryHandlePtyUpgrade(req, socket, head, {
          token: joinToken,
          ptyManager: this.ptyManager,
          requireTokenQuery: false,
        }, this.ptyWss)
      ) {
        return;
      }
    }

    if (!joinToken) {
      if (
        tryHandleBrowserStreamUpgrade(
          req,
          socket,
          head,
          { token: this.token },
          this.browserWss
        )
      ) {
        return;
      }
    } else if (meta.role === "control" && joinToken) {
      if (
        tryHandleBrowserStreamUpgrade(
          req,
          socket,
          head,
          { token: joinToken, requireTokenQuery: false },
          this.browserWss
        )
      ) {
        return;
      }
    }

    if (joinToken) {
      if (
        tryHandleRemoteUiStreamUpgrade(
          req,
          socket,
          head,
          {
            joinToken,
            role: meta.role === "control" ? "control" : "view",
            onInput: meta.role === "control" ? (input) => this.forwardRemoteUiInput(input) : undefined,
          },
          this.remoteUiWss
        )
      ) {
        return;
      }
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, meta));
  }

  private broadcastRemoteSession(status: RemoteSessionStatus): void {
    this.broadcast(serverFrame("remote_session", status));
  }

  private forwardRemoteUiInput(input: RemoteUiInput): void {
    const frame = serverFrame("remote_ui_input", input);
    const payload = JSON.stringify(frame);
    for (const ws of this.clients) {
      if (this.clientMeta.get(ws)?.role !== "owner") continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.send(payload);
    }
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
        if (addr && typeof addr === "object") {
          this.remoteHost.setPrimaryPort(addr.port);
          resolve(addr.port);
        } else reject(new Error("Failed to resolve sidecar port."));
      });
    });
  }

  private broadcast(frame: ServerFrame): void {
    const payload = JSON.stringify(frame);
    this.cloudRelay.forward(payload);
    for (const ws of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const meta = this.clientMeta.get(ws);
      if (meta?.role !== "owner" && meta?.chatId && frame.chatId && frame.chatId !== meta.chatId) {
        continue;
      }
      ws.send(payload);
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

  private clientRole(ws: WebSocket): RemoteClientMeta["role"] {
    return this.clientMeta.get(ws)?.role ?? "owner";
  }

  private async onConnection(ws: WebSocket, meta: RemoteClientMeta = { role: "owner" }): Promise<void> {
    this.clients.add(ws);
    this.clientMeta.set(ws, meta);
    if (meta.role !== "owner") {
      this.remoteHost.attachGuest(ws);
    }

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
    ws.on("close", () => {
      if (meta.role !== "owner") this.remoteHost.detachGuest(ws);
      this.clientMeta.delete(ws);
      this.clients.delete(ws);
    });
    ws.on("error", () => {
      if (meta.role !== "owner") this.remoteHost.detachGuest(ws);
      this.clientMeta.delete(ws);
      this.clients.delete(ws);
    });

    acceptCommands = true;
    for (const frame of pending) {
      void this.dispatch(ws, frame);
    }

    const guestChatId = meta.chatId;
    const clientRole = meta.role;

    // Let the UI connect immediately; full harness init can take 30–60s on cold start.
    this.sendTo(
      ws,
      serverFrame("hello", {
        protocolVersion: PROTOCOL_VERSION,
        sidecarVersion: SIDECAR_VERSION,
        activeChatId: guestChatId ?? "",
        chats: [],
        starting: clientRole === "owner",
        clientRole,
      })
    );

    if (clientRole !== "owner" && guestChatId) {
      await this.registry.open(guestChatId);
      this.sendTo(
        ws,
        serverFrame("sidecar_ready", {
          activeChatId: guestChatId,
          chats: this.registry.list(),
          clientRole,
        })
      );
      await this.unicastTranscriptReplay(ws, guestChatId);
      return;
    }

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
        clientRole: "owner",
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
    const role = this.clientRole(ws);
    if (!remoteCommandAllowed(role, command)) {
      this.ack(ws, id, false, `Command "${command}" not allowed for remote role "${role}".`);
      return;
    }
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
          const d = data as {
            workspaceRoot?: string;
            title?: string;
            kind?: "default" | "orchestrator";
          };
          const bridge = await this.registry.create({
            workspaceRoot: d.workspaceRoot,
            title: d.title,
            kind: d.kind === "orchestrator" ? "orchestrator" : "default",
          });
          this.broadcastChatList();
          this.ack(ws, id, true, undefined, { chatId: bridge.chatId });
          return;
        }

        case "get_or_create_orchestrator_chat": {
          try {
            const bridge = await this.registry.getOrCreateOrchestratorChat();
            this.broadcastChatList();
            this.ack(ws, id, true, undefined, { chatId: bridge.chatId });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "activate_chat": {
          const d = data as { chatId: string };
          const ok = await this.registry.activate(d.chatId);
          if (ok) this.broadcastChatList();
          this.ack(ws, id, ok, ok ? undefined : "Unknown chatId.");
          return;
        }

        case "open_chat": {
          const d = data as { chatId: string };
          const ok = await this.registry.open(d.chatId);
          this.ack(ws, id, ok, ok ? undefined : "Unknown chatId.");
          return;
        }

        case "delete_chat": {
          const d = data as { chatId: string };
          this.ptyManager.closeForChat(d.chatId);
          const newActive = await this.registry.delete(d.chatId);
          this.broadcastChatList();
          this.ack(ws, id, true, undefined, { activeChatId: newActive });
          return;
        }

        case "replay_transcript": {
          const d = data as { chatId: string };
          let bridge = this.registry.get(d.chatId);
          if (!bridge) {
            const ok = await this.registry.open(d.chatId);
            if (!ok) return this.ack(ws, id, false, "Unknown chatId.");
            bridge = this.registry.get(d.chatId);
          }
          if (!bridge) return this.ack(ws, id, false, "Unknown chatId.");
          await bridge.replayPersistedTranscript({ uiOnly: true });
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
            workflowPreset?: import("@liminal/core").ReceiptWorkflowPreset;
          };
          const bridge = this.registry.get(d.chatId);
          if (!bridge) return this.ack(ws, id, false, "Unknown chatId.");
          const msg = String(d.message ?? "").trim();
          const att = normalizeWireAttachments(d.attachments);
          if (!att.ok) return this.ack(ws, id, false, att.error);
          if (!msg && att.attachments.length === 0) {
            return this.ack(ws, id, false, "message or attachments required");
          }
          this.registry.touch(d.chatId, msg.slice(0, 60) || "Image attachment");
          this.broadcastChatList();
          this.ack(ws, id, true);
          bridge
            .sendUserMessage(msg, {
              freshContext: d.freshContext,
              liveDictation: d.liveDictation,
              imageAttachments: att.attachments,
              workflowPreset: d.workflowPreset,
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

        case "get_vireon_inference_models": {
          try {
            const d = data as { refresh?: boolean };
            const catalog = await fetchManagedInferenceModels({
              refresh: d.refresh === true,
            });
            if (!catalog) {
              return this.ack(ws, id, false, "Not signed in to Vireon");
            }
            this.ack(ws, id, true, undefined, catalog);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            this.ack(ws, id, false, message);
          }
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

        case "vireon_reconnect": {
          const snapshot = await vireonReconnect(this.registry);
          const wire = wireVireonAccountPayload(snapshot);
          this.broadcast(serverFrame("vireon_account", wire));
          this.broadcastChatList();
          const bridge = this.registry.getActiveBridge() ?? (await this.registry.getOrCreateActive());
          const config = await buildDesktopConfig(bridge, this.repoRoot);
          this.ack(ws, id, true, undefined, { ...wire, appConfig: wireAppConfig(config) });
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

        case "start_orchestration": {
          const d = data as { goal?: string; maxWorkers?: number; yolo?: boolean };
          try {
            const snap = this.orchestrator.start(String(d.goal ?? ""), {
              maxWorkers: d.maxWorkers,
              yolo: d.yolo,
            });
            this.broadcastChatList();
            this.ack(ws, id, true, undefined, snap);
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "stop_orchestration": {
          const d = data as { orchestrationId?: string };
          const ok = this.orchestrator.stop(d.orchestrationId);
          this.ack(ws, id, ok, ok ? undefined : "No orchestration to stop.");
          return;
        }

        case "get_orchestration": {
          const snap = this.orchestrator.getSnapshot();
          this.sendTo(ws, serverFrame("orchestration_status", snap));
          this.ack(ws, id, true, undefined, snap);
          return;
        }

        case "get_integrations": {
          try {
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, snap);
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_google_oauth": {
          const d = data as {
            services?: string[];
            mode?: "read_write" | "read_only";
            openBrowser?: boolean;
          };
          try {
            const result = await connectGoogleOAuth(this.registry, d);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { ...result, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_google_workspace": {
          const d = data as { services?: string[]; mode?: "read_write" | "read_only" };
          try {
            const output = await connectGoogleWorkspace(this.registry, d);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "disconnect_google": {
          const d = data as { revoke?: boolean };
          try {
            const output = await disconnectGoogle(this.registry, d.revoke === true);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_microsoft_oauth": {
          const d = data as {
            services?: string[];
            mode?: "read_write" | "read_only";
            openBrowser?: boolean;
          };
          try {
            const result = await connectMicrosoftOAuth(this.registry, d);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { ...result, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_microsoft_365": {
          const d = data as { services?: string[]; mode?: "read_write" | "read_only" };
          try {
            const output = await connectMicrosoft365(this.registry, d);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "disconnect_microsoft": {
          const d = data as { revoke?: boolean };
          try {
            const output = await disconnectMicrosoft(this.registry, d.revoke === true);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_azure_oauth": {
          const d = data as {
            services?: string[];
            mode?: "read_write" | "read_only";
            openBrowser?: boolean;
          };
          try {
            const result = await connectAzureOAuth(this.registry, d);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { ...result, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_azure": {
          const d = data as { services?: string[]; mode?: "read_write" | "read_only" };
          try {
            const output = await connectAzure(this.registry, d);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "disconnect_azure": {
          const d = data as { revoke?: boolean };
          try {
            const output = await disconnectAzure(this.registry, d.revoke === true);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_xero_oauth": {
          const d = data as {
            mode?: "read_write" | "read_only";
            extended?: boolean;
            fullScopes?: boolean;
            journals?: boolean;
            openBrowser?: boolean;
          };
          try {
            const result = await connectXeroOAuth(this.registry, d);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { ...result, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "disconnect_xero": {
          const d = data as { revoke?: boolean };
          try {
            const output = await disconnectXero(this.registry, d.revoke === true);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_slack_oauth": {
          const d = data as { mode?: "read_write" | "read_only"; openBrowser?: boolean };
          try {
            const result = await connectSlackOAuth(this.registry, d);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { ...result, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "disconnect_slack": {
          const d = data as { revoke?: boolean };
          try {
            const output = await disconnectSlack(this.registry, d.revoke === true);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_linear_oauth": {
          const d = data as { mode?: "read_write" | "read_only"; openBrowser?: boolean };
          try {
            const result = await connectLinearOAuth(this.registry, d);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { ...result, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "disconnect_linear": {
          const d = data as { revoke?: boolean };
          try {
            const output = await disconnectLinear(this.registry, d.revoke === true);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_notion_oauth": {
          const d = data as { mode?: "read_write" | "read_only"; openBrowser?: boolean };
          try {
            const result = await connectNotionOAuth(this.registry, d);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { ...result, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "disconnect_notion": {
          const d = data as { revoke?: boolean };
          try {
            const output = await disconnectNotion(this.registry, d.revoke === true);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_github_oauth": {
          const d = data as {
            mode?: "read_write" | "read_only";
            openBrowser?: boolean;
          };
          try {
            const result = await connectGithubOAuth(this.registry, d);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { ...result, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_github": {
          const d = data as { mode?: "read_write" | "read_only" };
          try {
            const output = await connectGithub(this.registry, {
              readOnly: d.mode === "read_only",
            });
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "disconnect_github": {
          const d = data as { revoke?: boolean };
          try {
            const output = await disconnectGithub(this.registry, d.revoke === true);
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "attach_integration_mcp": {
          const d = data as {
            name?: string;
            url?: string;
            read_only?: boolean;
            auth?: unknown;
          };
          try {
            const output = await attachIntegrationMcp(this.registry, {
              name: String(d.name ?? "").trim(),
              url: String(d.url ?? "").trim(),
              readOnly: d.read_only === true,
              auth: d.auth,
            });
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "detach_integration_mcp": {
          const d = data as { name?: string };
          try {
            const output = await detachIntegrationMcp(this.registry, String(d.name ?? "").trim());
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "connect_integration_openapi": {
          const d = data as {
            name?: string;
            specUrl?: string;
            baseUrl?: string;
            auth?: unknown;
            autoApproveReads?: boolean;
          };
          try {
            const output = await connectIntegrationOpenApi(this.registry, {
              name: String(d.name ?? "").trim(),
              specUrl: String(d.specUrl ?? "").trim(),
              baseUrl: typeof d.baseUrl === "string" ? d.baseUrl.trim() : undefined,
              auth: d.auth,
              autoApproveReads: d.autoApproveReads,
            });
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "disconnect_integration_openapi": {
          const d = data as { name?: string };
          try {
            const output = await disconnectIntegrationOpenApi(
              this.registry,
              String(d.name ?? "").trim()
            );
            const snap = await buildIntegrationsSnapshot();
            this.ack(ws, id, true, undefined, { output, integrations: snap });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "pty_open": {
          const d = data as {
            chatId: string;
            cols?: number;
            rows?: number;
            label?: string;
            source?: "agent" | "user";
            forceNew?: boolean;
            cwd?: string;
          };
          const chatId = String(d.chatId ?? "").trim();
          if (!chatId) return this.ack(ws, id, false, "chatId required");
          const workspaceRoot =
            this.registry.resolveWorkspaceForMedia(chatId) ??
            this.repoRoot;
          const info = this.ptyManager.open({
            chatId,
            workspaceRoot,
            cols: d.cols,
            rows: d.rows,
            label: d.label,
            source: d.source,
            forceNew: d.forceNew,
            cwd: d.cwd,
          });
          const payload = buildPtyOpenedPayload(info);
          this.broadcast(serverFrame("pty_opened", payload, chatId));
          this.ack(ws, id, true, undefined, payload);
          return;
        }

        case "pty_resize": {
          const d = data as { sessionId: string; cols: number; rows: number };
          const ok = this.ptyManager.resize(
            String(d.sessionId ?? ""),
            Number(d.cols),
            Number(d.rows)
          );
          this.ack(ws, id, ok, ok ? undefined : "Unknown sessionId.");
          return;
        }

        case "pty_close": {
          const d = data as { sessionId?: string; chatId?: string };
          let ok = false;
          if (d.sessionId?.trim()) {
            ok = this.ptyManager.close(d.sessionId.trim());
          } else if (d.chatId?.trim()) {
            this.ptyManager.closeForChat(d.chatId.trim());
            ok = true;
          } else {
            return this.ack(ws, id, false, "sessionId or chatId required");
          }
          this.ack(ws, id, ok, ok ? undefined : "Unknown sessionId.");
          return;
        }

        case "pty_list": {
          const d = data as { chatId?: string };
          const sessions = this.ptyManager.list(d.chatId?.trim());
          this.ack(ws, id, true, undefined, { sessions });
          return;
        }

        case "remote_enable": {
          const d = data as {
            chatId: string;
            mode?: "view" | "control";
            cloud?: boolean;
          };
          const chatId = d.chatId?.trim();
          if (!chatId) return this.ack(ws, id, false, "chatId required");
          const mode = d.mode === "control" ? "control" : "view";
          try {
            let cloudUrl: string | null = null;
            const result = await this.remoteHost.enable({ chatId, mode, cloud: d.cloud });
            if (d.cloud) {
              const cloud = await registerCloudRemoteSession({
                chatId,
                mode,
                joinCode: result.joinCode,
                joinToken: result.joinToken,
              });
              if (cloud) {
                cloudUrl = cloud.cloudUrl;
                result.cloudUrl = cloud.cloudUrl;
                this.cloudRelay.setRelay({
                  relayHostUrl: cloud.relayHostUrl,
                  joinCode: cloud.joinCode,
                  joinToken: result.joinToken,
                });
              } else {
                return this.ack(
                  ws,
                  id,
                  false,
                  "Cloud remote requires Vireon Pro sign-in (pro.remote_sessions)."
                );
              }
            } else {
              this.cloudRelay.clear();
            }
            this.ack(ws, id, true, undefined, {
              joinCode: result.joinCode,
              joinToken: result.joinToken,
              lanUrl: result.lanUrl,
              cloudUrl: cloudUrl ?? result.cloudUrl,
              expiresAt: result.expiresAt,
              mode,
            });
          } catch (err) {
            this.ack(ws, id, false, err instanceof Error ? err.message : String(err));
          }
          return;
        }

        case "remote_disable": {
          const d = data as { chatId?: string };
          for (const grant of this.remoteHost.activeGrants()) {
            clearRemoteUiStream(grant.joinToken);
          }
          const removed = this.remoteHost.disable(d.chatId?.trim());
          this.cloudRelay.clear();
          this.ack(ws, id, true, undefined, { removed });
          return;
        }

        case "remote_status": {
          const d = data as { chatId?: string };
          const status = this.remoteHost.status(d.chatId?.trim());
          this.ack(ws, id, true, undefined, status);
          return;
        }

        case "remote_revoke": {
          const d = data as { joinCode: string };
          const ok = this.remoteHost.revokeCode(d.joinCode ?? "");
          this.ack(ws, id, ok, ok ? undefined : "Unknown join code.");
          return;
        }

        case "remote_ui_frame": {
          if (this.clientRole(ws) !== "owner") {
            return this.ack(ws, id, false, "Owner only");
          }
          const d = data as {
            jpegBase64?: string;
            width?: number;
            height?: number;
            windowId?: string;
            title?: string;
            seq?: number;
          };
          const b64 = d.jpegBase64?.trim();
          const width = Number(d.width);
          const height = Number(d.height);
          if (!b64 || !Number.isFinite(width) || !Number.isFinite(height)) {
            return this.ack(ws, id, false, "jpegBase64, width, height required");
          }
          const buf = Buffer.from(b64, "base64");
          const meta = {
            width,
            height,
            windowId: d.windowId,
            title: d.title,
          };
          for (const grant of this.remoteHost.activeGrants()) {
            publishRemoteUiFrame(grant.joinToken, buf, meta);
          }
          this.cloudRelay.forwardUiFrame({
            jpegBase64: b64,
            width,
            height,
            windowId: d.windowId,
            title: d.title,
            seq: d.seq,
          });
          this.ack(ws, id, true);
          return;
        }

        case "remote_ui_poll_input": {
          if (this.clientRole(ws) !== "owner") {
            return this.ack(ws, id, false, "Owner only");
          }
          const d = data as { joinCode?: string };
          const code = d.joinCode?.trim().toUpperCase();
          const grant = code ? this.remoteHost.resolveJoinCode(code) : this.remoteHost.activeGrants()[0];
          if (!grant) {
            this.ack(ws, id, true, undefined, { events: [] });
            return;
          }
          const events = await this.cloudRelay.pollInputs(grant.joinCode, grant.joinToken);
          for (const ev of events) {
            const input = ev as RemoteUiInput;
            this.forwardRemoteUiInput(input);
          }
          this.ack(ws, id, true, undefined, { events });
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
    this.ptyManager.disposeAll();
    this.remoteHost.dispose();
    this.ptyWss.close();
    this.browserWss.close();
    this.wss.close();
    this.http.close();
  }

  /** Loopback port after `listen()` — used by terminal embed pages. */
  getHttpPort(): number | null {
    const addr = this.http.address();
    if (addr && typeof addr === "object") return addr.port;
    return null;
  }

  getPtyManager(): PtyManager {
    return this.ptyManager;
  }

  getToken(): string {
    return this.token;
  }
}
