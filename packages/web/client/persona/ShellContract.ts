import type React from "react";
import type { PersonaUiThemeV2 } from "@liminal/core/persona-ui-theme";
import type {
  MessageEntry,
  AutoDreamState,
  PersonalityPulseRow,
  ApiReachable,
  SseTransport,
} from "../useSSE.js";
import type { ImageAttachment } from "../imageAttachments.js";

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
  toolResultMap: Map<string, ToolResult>;
  surface: ToolSurface;
  showRawHarness: boolean;
  rawHarnessBlob: string;
  error: string | null;

  // ── Input ────────────────────────────────────────────────────────────────────
  input: string;
  attachments: ImageAttachment[];
  attachError: string | null;
  isDragOver: boolean;
  canSend: boolean;
  totalAttachmentKb: number;
  busy: boolean;

  // ── Input handlers ────────────────────────────────────────────────────────────
  onInputChange(v: string): void;
  onSubmit(e: React.FormEvent): void;
  onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): Promise<void>;
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
   * (persona/shells/ShellControls.tsx), which wires all three handlers below.
   * <ShellControls> is the single source of truth — do not hand-roll these
   * buttons per shell. A shell that omits it strands the user with no way to
   * reach Settings or reset the session, which is the bug class this contract
   * exists to prevent.
   *
   *   onOpenSettings  — open the settings modal (must work even mid-turn).
   *   onClearSession  — reset to a fresh session.
   *   onToggleRaw     — toggle raw harness trace visibility.
   *
   * Shell-specific extras (e.g. HudShell's CAPTURE/screenshot) are optional and
   * rendered alongside <ShellControls>, never as a replacement for it.
   */
  onClearSession(): Promise<void>;
  onOpenSettings(): void;
  onToggleRaw(): void;
  /** Abort in-progress turn (POST /api/session/abort). */
  onAbortTurn?: () => void;
}
