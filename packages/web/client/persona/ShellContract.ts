import type React from "react";
import type { PersonaUiThemeV2 } from "@liminal/core/persona-ui-theme";
import type {
  MessageEntry,
  AutoDreamState,
  PersonalityPulseRow,
  ApiReachable,
  SseTransport,
} from "../useSSE.js";
import type { ChatTurn } from "../chatTurnLayout.js";
import type { ImageAttachment } from "../imageAttachments.js";
import type { SlashCompletionItem } from "@liminal/core";

export type ToolCallEntry = Extract<MessageEntry, { kind: "tool_call" }>;
export type SubtaskEntry  = Extract<MessageEntry, { kind: "subtask" }>;
export type ToolResult    = { output: string; ok: boolean };
export type ToolCallGroup = { kind: "tool_group"; name: string; entries: ToolCallEntry[] };
export type ToolSurface   = "clean" | "verbose";
export type CompletedPulseRow = Extract<PersonalityPulseRow, { phase: "completed" }>;

export type OrbState =
  | "idle" | "thinking" | "running" | "approval"
  | "error" | "disconnected" | "degraded" | "pulse";

export interface SignalHud {
  label: string;
  color: string;
  detail: string;
}

export interface ContextSnapshot {
  usageFraction: number;
  masked?: boolean;
}

/** Everything shells receive from App.tsx. Shells own their own DOM refs and local UX state. */
export interface ShellContract {
  // ── Persona ─────────────────────────────────────────────────────────────────
  personaTheme: PersonaUiThemeV2;
  personaDisplayLabel: string;
  personaName: string;

  // ── Messages ─────────────────────────────────────────────────────────────────
  groupedMessages: (MessageEntry | ToolCallGroup)[];
  chatTurns: ChatTurn[];
  toolResultMap: Map<string, ToolResult>;
  surface: ToolSurface;
  showRawHarness: boolean;
  rawHarnessBlob: string;
  error: string | null;

  // ── Input ────────────────────────────────────────────────────────────────────
  input: string;
  attachments: ImageAttachment[];
  attachError: string | null;
  slashNotice: string | null;
  slashCompletion?: {
    items: SlashCompletionItem[];
    selectedIndex: number;
    visible: boolean;
    onPick(item: SlashCompletionItem): void;
  };
  isDragOver: boolean;
  canSend: boolean;
  canProcessReceipts: boolean;
  totalAttachmentKb: number;
  busy: boolean;

  // ── Input handlers ────────────────────────────────────────────────────────────
  onInputChange(v: string): void;
  onSubmit(e: React.FormEvent): void;
  onProcessReceipts(): void;
  onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): Promise<void>;
  onComposerSelect?(el: HTMLTextAreaElement): void;
  onPaste(e: React.ClipboardEvent<HTMLElement>): Promise<void>;
  onDragOver(e: React.DragEvent<HTMLFormElement>): void;
  onDragLeave(e: React.DragEvent<HTMLFormElement>): void;
  onDrop(e: React.DragEvent<HTMLFormElement>): Promise<void>;
  onRemoveAttachment(idx: number): void;

  // ── Agent state ──────────────────────────────────────────────────────────────
  orbState: OrbState;
  signalHud: SignalHud;
  pct: number;
  contextSnapshot: ContextSnapshot | null;
  sessionSeconds: number;
  toolCount: number;
  msgCount: number;
  toolErrorCount: number;
  subtasks: SubtaskEntry[];
  allToolCalls: ToolCallEntry[];
  autoDream: AutoDreamState;
  uiVerbosity: "normal" | "quiet";
  pulseChips: CompletedPulseRow[];
  lastTurnProviderRetries: number;
  lastContextCompress: { beforePct: number; afterPct: number; rounds: number } | null;
  heartbeatEnabled: boolean;
  heartbeatUiStrip: boolean;
  personalityPulseActive: boolean;
  personalityPulseRows: PersonalityPulseRow[];
  dreamLabel: string;
  activeToolCall: ToolCallEntry | undefined;
  windowWidth: number;
  showPanels: boolean;

  // ── Actions (REQUIRED CONTROLS — see note below) ──────────────────────────────
  /**
   * Required controls contract.
   *
   * Every persona shell MUST render the shared <ShellControls> component
   * (persona/shells/ShellControls.tsx), which wires the handlers below.
   * <ShellControls> is the single source of truth — do not hand-roll these
   * buttons per shell. A shell that omits it strands the user with no way to
   * reach Settings or reset the session, which is the bug class this contract
   * exists to prevent.
   *
   *   onOpenSettings  — open the settings modal (must work even mid-turn).
   *   onClearSession  — reset to a fresh session.
   *   onToggleRaw     — toggle raw harness trace visibility.
   *
   * Screenshot (session PNG) lives in <ShellControls> — pass each shell's
   * `messagesRef` so capture works in every persona style.
   *
   * Message input lives in <ShellComposer> (persona/shells/ShellComposer.tsx) —
   * textarea, dictation mic, attachments, send/abort. Do not hand-roll per shell.
   */
  onClearSession(): Promise<void>;
  onOpenSettings(): void;
  onToggleRaw(): void;
  /** Abort in-progress turn (POST /api/session/abort). */
  onAbortTurn?: () => void;

  /** Open the sub-agent inspector for a spawned task id. */
  onInspectSubtask?(taskId: string): void;

  // ── Dictation (wired by ShellComposer) ───────────────────────────────────────
  dictationAudioCue: boolean;
  /** Mic session armed (continuous listening) — server voice/dictation mode for sends. */
  onDictationSessionActive?: (active: boolean) => void;
  /** Mic is recording / uploading / transcribing — pause agent TTS during capture only. */
  onDictationCaptureActive?: (active: boolean) => void;
  /** Block mic VAD while agent TTS is playing (avoids cutting off playback). */
  shouldBlockDictationCapture?: () => boolean;
  /** Unlock browser autoplay (mic arm / send). */
  onUnlockSpeechAudio?: () => void;
  /** Pause-to-send or manual stop — return an error string for the composer banner. */
  onDictationAutoSend: (fullMessage: string) => void | string;
  onDictationHistoryReset?: () => void;
  /** Jarvis-style spoken channel enabled (AGENT_TTS_ENABLED). */
  ttsEnabled?: boolean;
  /** Last line spoken on the audio channel (accessibility). */
  ttsLastSpoken?: string | null;
  /** Browser blocked playback or fetch failed. */
  ttsPlayError?: string | null;
}
