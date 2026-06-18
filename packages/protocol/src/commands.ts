import type { ApprovalDecision, ImageAttachmentSource } from "@liminal/core";

/** Chat attachment on the wire (any file as base64 data URL). */
export interface WireChatAttachment {
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  source?: ImageAttachmentSource;
}

/** @deprecated alias — wire format supports any MIME, not only images */
export type WireImageAttachment = WireChatAttachment;

/**
 * UI → server commands.
 *
 * Every command is request/response: the UI sends a {@link ClientFrame} with a
 * unique `id`, and the sidecar replies with a `command_result` event carrying
 * the same `id`. Streaming side effects (assistant text, tool calls) arrive as
 * independent server events, not as the command's return value.
 */
export interface ClientCommandMap {
  /** Start a turn. Resolves (command_result) once the send has been accepted, not when the turn ends. */
  send_message: {
    chatId: string;
    message: string;
    freshContext?: boolean;
    liveDictation?: boolean;
    attachments?: WireChatAttachment[];
    /** Guided preset — e.g. `receipt_to_xero` (requires image attachments). */
    workflowPreset?: "receipt_to_xero";
  };
  /** Cooperatively abort the in-flight turn for a chat. */
  abort: { chatId: string };
  /** Resolve a pending `tool_approval`. `approvalNonce` must match the one from the event. */
  resolve_approval: {
    chatId: string;
    callId: string;
    approvalNonce: string;
    decision: ApprovalDecision;
  };
  /** Answer a pending `ask_user` prompt. */
  resolve_ask_user: { chatId: string; answer: string };

  /** Create a new chat (optionally bound to a workspace folder) and return its summary. */
  create_chat: { workspaceRoot?: string; title?: string; kind?: "default" | "orchestrator" };
  /** Return the persistent Mission Control chat (create if missing). */
  get_or_create_orchestrator_chat: Record<string, never>;
  /** Make a chat the live event source. */
  activate_chat: { chatId: string };
  /** Open harness + hydrate transcript without changing the active chat. */
  open_chat: { chatId: string };
  /** Permanently dispose a chat and its harness. */
  delete_chat: { chatId: string };
  /** Re-request the chat list (also pushed proactively on change). */
  list_chats: Record<string, never>;
  /** Push `transcript_replay` from disk for a chat (UI refresh after connect). */
  replay_transcript: { chatId: string };

  /** Clear a chat's transcript; `greet` re-runs the opening greeting / bootstrap gate. */
  reset_session: { chatId: string; greet?: boolean; rebootstrap?: boolean };
  /** Submit persona-bootstrap input (or `skip`) for a chat awaiting it. */
  submit_persona_bootstrap: { chatId: string; input: string; skip?: boolean };

  /** App shell snapshot (provider configured, persona bootstrap gate, display label). */
  get_config: Record<string, never>;
  /** Fetch the effective settings snapshot. */
  get_settings: Record<string, never>;
  /** Patch managed settings (persisted to runtime prefs by the harness). */
  update_settings: { patch: Record<string, unknown> };
  /**
   * Persist BYOK provider credentials (writes `AGENT_API_KEY` to repo `.env`) and
   * refresh every live harness. Secrets are never returned on the wire.
   */
  save_provider: { apiKey: string; model?: string; baseURL?: string };

  /** Vireon account + license snapshot (`~/.liminal/account.json`). */
  get_vireon_account: Record<string, never>;
  /**
   * Browser loopback sign-in (same as `liminal login` / web Settings).
   * Blocks until the site posts a license token or the flow times out (~5m).
   */
  vireon_sign_in: { openBrowser?: boolean };
  /** Clear local Vireon license + account binding. */
  vireon_sign_out: Record<string, never>;
  /** Re-resolve BYOK vs managed inference after sign-in or harness update. */
  vireon_reconnect: Record<string, never>;
  /** Bedrock model catalog for Pro managed inference (license Bearer). */
  get_vireon_inference_models: Record<string, never>;

  /** List persisted Liminal desktop apps + cache snapshots. */
  list_apps: Record<string, never>;
  /** Ask desktop shell to open (or focus) a window for an existing app. */
  open_app_window: { appId: string };
  /** Force refresh one app's data cache. */
  refresh_app: { appId: string };
  /** Remove app spec + cache (same as close_app tool). */
  remove_app: { appId: string };
  /** User/settings patch for an app spec. */
  update_app: {
    appId: string;
    title?: string;
    props?: Record<string, unknown>;
    refresh?: { interval_min: number };
    auto_open?: boolean;
  };

  /** Keepalive. Sidecar answers with a `pong` event. */
  ping: Record<string, never>;

  /**
   * Start a multi-chat orchestration: plan → spawn worker chats → synthesize.
   * Progress streams via `orchestration_status`.
   */
  start_orchestration: {
    goal: string;
    maxWorkers?: number;
    /** Auto-approve tool gates (default true). */
    yolo?: boolean;
  };
  /** Cooperatively stop the active orchestration. */
  stop_orchestration: { orchestrationId?: string };
  /** Snapshot of the current or last orchestration run. */
  get_orchestration: Record<string, never>;

  /** Google / MCP / OpenAPI integration snapshot (Settings parity). */
  get_integrations: Record<string, never>;
  connect_google_oauth: {
    services?: string[];
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
    attach?: boolean;
  };
  connect_google_workspace: {
    services?: string[];
    mode?: "read_write" | "read_only";
  };
  disconnect_google: { revoke?: boolean };
  connect_microsoft_oauth: {
    services?: string[];
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
    attach?: boolean;
  };
  connect_microsoft_365: {
    services?: string[];
    mode?: "read_write" | "read_only";
  };
  disconnect_microsoft: { revoke?: boolean };
  connect_azure_oauth: {
    services?: string[];
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
    attach?: boolean;
  };
  connect_azure: {
    services?: string[];
    mode?: "read_write" | "read_only";
  };
  disconnect_azure: { revoke?: boolean };
  connect_xero_oauth: {
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
  };
  disconnect_xero: { revoke?: boolean };
  connect_slack_oauth: {
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
  };
  disconnect_slack: { revoke?: boolean };
  connect_linear_oauth: {
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
  };
  disconnect_linear: { revoke?: boolean };
  connect_notion_oauth: {
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
  };
  disconnect_notion: { revoke?: boolean };
  connect_youtube_oauth: {
    mode?: "read_write" | "read_only";
    monetary?: boolean;
    openBrowser?: boolean;
  };
  disconnect_youtube: { revoke?: boolean };
  revoke_integration_account: { provider: string; accountId: string };
  connect_github_oauth: {
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
    attach?: boolean;
  };
  connect_github: { mode?: "read_write" | "read_only" };
  disconnect_github: { revoke?: boolean };
  attach_integration_mcp: {
    name: string;
    url: string;
    read_only?: boolean;
    auth?: { kind?: string; envVar?: string; headerName?: string };
  };
  detach_integration_mcp: { name: string };
  connect_integration_openapi: {
    name: string;
    specUrl: string;
    baseUrl?: string;
    auth?: { kind?: string; envVar?: string; headerName?: string };
    autoApproveReads?: boolean;
  };
  disconnect_integration_openapi: { name: string };

  /** Open (or reattach to) an interactive shell session for a chat. */
  pty_open: {
    chatId: string;
    cols?: number;
    rows?: number;
    label?: string;
    source?: "agent" | "user";
    /** When true, always spawn a new tab instead of reusing the primary session. */
    forceNew?: boolean;
    cwd?: string;
  };
  /** Resize the chat's PTY grid. */
  pty_resize: { sessionId: string; cols: number; rows: number };
  /** Close the interactive shell session. */
  pty_close: { sessionId?: string; chatId?: string };
  /** List active PTY sessions (optional chat filter). */
  pty_list: { chatId?: string };

  /** Enable remote join link for a chat (view by default). */
  remote_enable: {
    chatId: string;
    mode?: "view" | "control";
    cloud?: boolean;
  };
  /** Revoke all remote grants for a chat (or active chat when omitted). */
  remote_disable: { chatId?: string };
  /** Snapshot of active remote grants and guest count. */
  remote_status: { chatId?: string };
  /** Revoke a single join code. */
  remote_revoke: { joinCode: string };
  /** Owner publishes a JPEG UI frame for remote guests. */
  remote_ui_frame: {
    jpegBase64: string;
    width: number;
    height: number;
    windowId?: string;
    title?: string;
    seq?: number;
  };
  /** Owner polls cloud relay for queued remote UI input events. */
  remote_ui_poll_input: { joinCode: string };

  /** Current inbox triage queue snapshot. */
  get_inbox_status: Record<string, never>;
  /** Escalate triaged items to the harness in a chat. */
  process_inbox_items: { chatId: string; itemIds: string[] };
  /** Mark inbox items handled without harness. */
  dismiss_inbox_items: { itemIds: string[] };
  /** Persist VIP / newsletter domain rules for inbox heuristics. */
  update_inbox_rules: {
    vipSenders?: string[];
    newsletterDomains?: string[];
    denyDomains?: string[];
  };
  /** Run one inbox poll cycle immediately (sidecar background). */
  trigger_inbox_watch: Record<string, never>;
}

export type ClientCommandType = keyof ClientCommandMap;

/** Convenience: payload type for a given client command. */
export type ClientCommandData<T extends ClientCommandType> = ClientCommandMap[T];
