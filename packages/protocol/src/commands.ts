import type { ApprovalDecision, ImageAttachmentSource } from "@liminal/core";

/** Image attached to `send_message` (base64 data URL on the wire). */
export interface WireImageAttachment {
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  source?: ImageAttachmentSource;
}

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
    attachments?: WireImageAttachment[];
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
  create_chat: { workspaceRoot?: string; title?: string };
  /** Make a chat the live event source. */
  activate_chat: { chatId: string };
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
}

export type ClientCommandType = keyof ClientCommandMap;

/** Convenience: payload type for a given client command. */
export type ClientCommandData<T extends ClientCommandType> = ClientCommandMap[T];
