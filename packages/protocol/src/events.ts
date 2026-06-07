import type { AgentEventMap, PersonaBootstrapProgressEvent } from "@liminal/core";

/**
 * Server → UI events.
 *
 * Two sources are unioned here:
 *  1. {@link WireAgentEventMap} — every harness emitter event from core's
 *     `AgentEventMap`, made JSON-safe (functions stripped, `Error` flattened).
 *  2. {@link TransportEventMap} — events the sidecar synthesizes that the
 *     harness itself never emits (handshake, chat list, command acks).
 *
 * Because {@link WireAgentEventMap} is *derived* from core's `AgentEventMap`,
 * any drift in a harness event payload is a compile error in the sidecar's
 * mapper — that is the whole point of freezing the protocol here.
 */

/** JSON-safe replacement for a thrown `Error` (Error does not serialize). */
export interface WireError {
  message: string;
  name?: string;
  stack?: string;
}

/**
 * On the wire, `tool_approval` loses its `resolve` callback (the sidecar holds
 * it) and gains a one-time `approvalNonce` the UI must echo back in the
 * `resolve_approval` command — preventing a stale/duplicate decision from
 * resolving the wrong gate.
 */
export type WireToolApproval = Omit<AgentEventMap["tool_approval"], "resolve"> & {
  approvalNonce: string;
};

/** On the wire, `ask_user` loses its `resolve` callback; the UI replies via `resolve_ask_user`. */
export type WireAskUser = Omit<AgentEventMap["ask_user"], "resolve">;

/** Every harness event, serialization-safe. Keys identical to core's `AgentEventMap`. */
export type WireAgentEventMap = Omit<
  AgentEventMap,
  "tool_approval" | "ask_user" | "error"
> & {
  tool_approval: WireToolApproval;
  ask_user: WireAskUser;
  error: WireError;
};

/** One chat/session in the sidecar's `ChatManager`. */
export interface ChatSummary {
  chatId: string;
  title: string;
  workspaceRoot: string;
  /** Wall-clock ms of last activity — UI sorts most-recent-first. */
  updatedAt: number;
  /** True while the harness is mid-turn. */
  busy: boolean;
  /** True while this chat is the live SSE/WS source. */
  active: boolean;
  /** True while the chat is blocked on persona bootstrap input. */
  awaitingPersonaBootstrap: boolean;
}

/** Desktop shell config snapshot (hello / sidecar_ready). */
export interface WireAppConfig {
  apiKeyConfigured: boolean;
  personaBootstrapEnabled: boolean;
  personaBootstrapPending: boolean;
  personaBootstrapAllowSkip: boolean;
  personaDisplayLabel: string;
  provider: {
    model: string;
    baseURL: string;
    modelLockedByEnv: boolean;
    baseURLLockedByEnv: boolean;
  };
  repoRoot: string;
  /** Persona presentation JSON (`persona/active/ui_theme.json`) when present. */
  personaUiTheme?: Record<string, unknown>;
  /** Persona interface microcopy (`persona/active/ui_copy.json`) when present. */
  personaUiCopy?: Record<string, unknown>;
  /** `AGENT_TTS_ENABLED=1` */
  ttsEnabled?: boolean;
  /** `AGENT_TTS_VOICE` */
  ttsVoice?: string;
  /** `AGENT_DICTATION_AUDIO_CUE=1` */
  dictationAudioCue?: boolean;
  /** Pause-send tuning (ms) — mirrors web `/api/config`. */
  dictationMinRecordingMs?: number;
  dictationSilenceMsShort?: number;
  dictationSilenceMsLong?: number;
  dictationMaxRecordingMs?: number;
}

/** Events the sidecar emits that have no harness equivalent. */
export interface TransportEventMap {
  /** First frame after a socket attaches — declares protocol version + active chat. */
  hello: {
    protocolVersion: number;
    sidecarVersion: string;
    activeChatId: string;
    chats: ChatSummary[];
    /** True while tool registration is still running; UI should wait for `sidecar_ready`. */
    starting?: boolean;
    /** Shell snapshot so the UI can render without racing `get_config`. */
    appConfig?: WireAppConfig;
  };
  /** Sent when the first harness + chat exist; follows a `starting` hello. */
  sidecar_ready: {
    activeChatId: string;
    chats: ChatSummary[];
    appConfig?: WireAppConfig;
  };
  /** Busy reconciliation tick (mirrors the web `harness_running` heartbeat). */
  harness_running: { chatId: string; startedAt: number };
  /** Pushed whenever the chat set or active chat changes; also answers `list_chats`. */
  chat_list: { chats: ChatSummary[]; activeChatId: string };
  /** Prior turns rebuilt from `session.jsonl` after restart or chat activation. */
  transcript_replay: {
    chatId: string;
    entries: Array<{
      id: string;
      kind: "user" | "assistant" | "tool_call" | "error";
      turnIndex?: number;
      text?: string;
      toolName?: string;
      toolCallId?: string;
      toolArgs?: Record<string, unknown>;
      toolOk?: boolean;
      toolOutput?: string;
    }>;
  };
  /** Per-command acknowledgement, correlated by the command's `id`. */
  command_result: { commandId: string; ok: boolean; error?: string; data?: unknown };
  /** Current effective settings snapshot (answers `get_settings` / follows `update_settings`). */
  settings: { values: Record<string, unknown> };
  /** Vireon account + license snapshot (answers `get_vireon_account` / follows sign-in/out). */
  vireon_account: {
    connected: boolean;
    account: Record<string, unknown> | null;
    tier: string;
    licensed: boolean;
    entitlements: string[];
    orgId: string | null;
  };
  /** Keepalive response to a `ping` command. */
  pong: { at: number };
  /** Persona bootstrap pipeline progress (sidecar-synthesized, mirrors web SSE). */
  persona_bootstrap_progress: PersonaBootstrapProgressEvent;

  /** Full desktop app registry + caches. */
  app_list: {
    apps: WireLiminalAppSpec[];
    caches: Record<string, WireAppCacheEntry>;
  };
  /** Desktop should open a separate OS window for this app. */
  app_spawned: { app: WireLiminalAppSpec };
  /** Desktop should refresh an existing window (no new OS window). */
  app_updated: { app: WireLiminalAppSpec };
  /** Desktop should close the window for this app id. */
  app_closed: { appId: string };
  /** Fresh cache payload for one app (refresh loop or manual). */
  app_data: { appId: string; cache: WireAppCacheEntry };
}

/** Wire shape for `~/.liminal/apps/manifest.json` entries. */
export interface WireLiminalAppSpec {
  v: 1;
  id: string;
  type: string;
  title: string;
  props: Record<string, unknown>;
  refresh?: { interval_min: number };
  placement?: { width: number; height: number; x?: number; y?: number };
  auto_open?: boolean;
  created_at: number;
  updated_at: number;
  source: "model" | "user";
}

export interface WireAppCacheEntry {
  fetched_at: number;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** The full server→UI event surface. */
export type ServerEventMap = WireAgentEventMap & TransportEventMap;
export type ServerEventType = keyof ServerEventMap;

/** Convenience: payload type for a given server event. */
export type ServerEventData<T extends ServerEventType> = ServerEventMap[T];
