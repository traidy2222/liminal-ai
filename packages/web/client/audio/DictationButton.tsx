import React, { useCallback, useEffect, useState } from "react";
import { useDictation, type DictationCost } from "./useDictation.js";

/**
 * Mic button with live dictation, Whisper refinement, and optional auto-send.
 *
 * Three button modes (icon shifts to show what's active):
 *   🎤   — idle, manual mode (click to dictate, click again to stop+send manually)
 *   🎤⚡  — idle, auto-send mode (records until you stop talking, then sends)
 *   ⏹   — recording, manual mode
 *   ⏹⚡  — recording, auto-send mode (countdown chip appears on pause)
 *
 * Auto-send toggle is per-session — click ⚡ next to the mic to flip it on/off
 * for the next recording. Default off (surprise-action principle).
 *
 * Keyboard:
 *   - Escape (while recording): cancel pending auto-send, stay recording
 *   - Escape (twice while recording): discard everything
 *
 * Three callback streams the consumer (App.tsx) wires:
 *   onAppendFinal(text)              — Web Speech committed a final → append to input
 *   onInterimText(text)              — Web Speech interim → show as preview
 *   onRefinedFull(text, cost, sent)  — Whisper finished → replace span (or update sent msg)
 *   onAutoSend(text)                 — auto-send fired → consumer triggers submit
 *   onStart()                        — recording started → snapshot input cursor
 */
export interface DictationButtonProps {
  onAppendFinal: (text: string) => void;
  onInterimText: (text: string) => void;
  onRefinedFull: (text: string, cost: DictationCost, wasAutoSent: boolean) => void;
  onAutoSend: (text: string) => void;
  onStart?: () => void;
  /** Persistent default for auto-send (from env / settings). User can override per-session. */
  autoSendDefault?: boolean;
  /** Audio cue plays a short tone when auto-send fires. Default off. */
  audioCue?: boolean;
  /** Tuning knobs — usually left to the in-hook defaults. */
  minRecordingMs?: number;
  silenceMsShort?: number;
  silenceMsLong?: number;
  maxRecordingMs?: number;
  language?: string;
  prompt?: string;
  hideCostChip?: boolean;
  className?: string;
}

export const DictationButton: React.FC<DictationButtonProps> = ({
  onAppendFinal,
  onInterimText,
  onRefinedFull,
  onAutoSend,
  onStart,
  autoSendDefault = false,
  audioCue = false,
  minRecordingMs,
  silenceMsShort,
  silenceMsLong,
  maxRecordingMs,
  language,
  prompt,
  hideCostChip,
  className,
}) => {
  // Per-session toggle, seeded from autoSendDefault on first mount only.
  //
  // We DELIBERATELY don't sync the prop into local state on every change.
  // The default flows in from `/api/config` which can re-fetch at any time
  // (SSE reconnect, chat_switched, settings update). If we re-synced on
  // every prop change, the user's manual ⚡ toggle would flip back whenever
  // the server re-emitted the config — destroying their session-level choice.
  //
  // Once mounted, the local toggle is the source of truth. To change it,
  // user clicks ⚡; to change the persisted default, edit Settings or env.
  const [autoSendEnabled, setAutoSendEnabled] = useState(autoSendDefault);
  // Re-sync only when the prop transitions from undefined → defined on the
  // very first config arrival (component mounts before /api/config returns,
  // initial autoSendDefault is false; first non-false update is the real one).
  const initialDefaultAppliedRef = React.useRef(false);
  useEffect(() => {
    if (initialDefaultAppliedRef.current) return;
    initialDefaultAppliedRef.current = true;
    setAutoSendEnabled(autoSendDefault);
  }, [autoSendDefault]);

  const { state, start, stop, cancel, cancelPendingAutoSend } = useDictation({
    onFinal: (text) => onAppendFinal(text),
    onInterim: (text) => onInterimText(text),
    onWhisperRefinement: (text, cost, sent) => onRefinedFull(text, cost, sent),
    onAutoSend,
    language,
    prompt,
    autoSend: autoSendEnabled
      ? {
          enabled: true,
          audioCue,
          minRecordingMs,
          silenceMsShort,
          silenceMsLong,
          maxRecordingMs,
        }
      : { enabled: false },
  });

  const isRecording = state.status === "recording";

  // Escape key: cancel pending auto-send first; if pressed again, cancel
  // recording entirely. Provides a clear two-step abort.
  useEffect(() => {
    if (!isRecording) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (state.autoSendCountdownMs != null) {
        e.preventDefault();
        cancelPendingAutoSend();
      } else {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRecording, state.autoSendCountdownMs, cancel, cancelPendingAutoSend]);

  const onClickMic = useCallback(() => {
    if (isRecording) {
      // The hook itself guards stop() during the warmup window, but skipping
      // here too avoids a misleading status flash and keeps the UX intent
      // ("click was ignored because we just started") explicit.
      if (state.warmingUp) {
        console.debug("[dictation] mic click ignored during warmup");
        return;
      }
      void stop();
      return;
    }
    if (state.status === "idle" || state.status === "done" || state.status === "error") {
      onStart?.();
      void start();
    }
  }, [isRecording, state.warmingUp, state.status, start, stop, onStart]);

  if (!state.supported) {
    return (
      <span
        title="MediaRecorder not supported in this browser."
        style={{ fontSize: 11, color: "rgba(217,226,236,0.35)", padding: "0 4px" }}
      >
        🎤×
      </span>
    );
  }

  // ── Visual state ────────────────────────────────────────────────────────
  let icon = "🎤";
  let title = state.liveTranscriptionSupported
    ? "Click to dictate (live transcription enabled)"
    : "Click to dictate (transcribes on stop — your browser lacks live speech recognition)";
  let color = "rgba(217,226,236,0.6)";
  let bg = "transparent";
  if (state.status === "permission-pending") {
    icon = "⏳";
    title = "Waiting for microphone permission…";
  } else if (isRecording) {
    icon = "⏹";
    title = autoSendEnabled
      ? "Recording — will auto-send when you stop talking. Esc to cancel countdown."
      : state.liveTranscriptionSupported
        ? "Recording — words appear in input as you speak. Click to stop + refine with Whisper."
        : "Recording — click to stop and transcribe.";
    color = "#ff4488";
    bg = "rgba(255,68,136,0.12)";
  } else if (state.status === "uploading") {
    icon = "↑";
    title = "Uploading for Whisper refinement…";
    color = "var(--lim-accent, #00d4ff)";
  } else if (state.status === "transcribing") {
    icon = "⟳";
    title = "Whisper refining transcript…";
    color = "var(--lim-accent, #00d4ff)";
  } else if (state.status === "error") {
    icon = "⚠";
    title = state.error ?? "Dictation error";
    color = "#ff8888";
  }

  const countdownSecs =
    state.autoSendCountdownMs != null ? (state.autoSendCountdownMs / 1000).toFixed(1) : null;

  return (
    <div
      className={className}
      style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}
    >
      {/* Auto-send countdown chip — only when a pause has actually been detected. */}
      {countdownSecs && (
        <div
          style={{
            padding: "3px 8px",
            background: "rgba(255,68,136,0.18)",
            color: "#ff4488",
            border: "1px solid rgba(255,68,136,0.5)",
            borderRadius: 3,
            fontSize: 10,
            fontFamily: "monospace",
            fontWeight: 600,
            whiteSpace: "nowrap",
            animation: "data-pulse 0.5s ease-in-out infinite",
          }}
        >
          ⚡ auto-sending in {countdownSecs}s · keep talking or Esc to cancel
        </div>
      )}

      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {/* ⚡ toggle — visible only when idle so user can enable for next take. */}
        {!isRecording && state.status !== "uploading" && state.status !== "transcribing" && (
          <button
            type="button"
            onClick={() => setAutoSendEnabled((v) => !v)}
            title={
              autoSendEnabled
                ? "Auto-send is ON. Recording will auto-stop and send when you pause. Click to switch back to manual."
                : "Auto-send is OFF. Click to enable: recording will auto-stop and send when you pause talking."
            }
            aria-label={autoSendEnabled ? "Disable auto-send" : "Enable auto-send"}
            style={{
              width: 22,
              height: 28,
              background: autoSendEnabled ? "rgba(255,200,0,0.18)" : "transparent",
              color: autoSendEnabled ? "#ffc800" : "rgba(217,226,236,0.45)",
              border: autoSendEnabled
                ? "1px solid rgba(255,200,0,0.55)"
                : "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.18)",
              borderRadius: 3,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ⚡
          </button>
        )}

        <button
          type="button"
          onClick={onClickMic}
          disabled={state.status === "permission-pending" || state.status === "uploading" || state.status === "transcribing"}
          title={title}
          aria-label={title}
          style={{
            width: 32,
            height: 28,
            background: bg,
            color,
            border: isRecording
              ? "1px solid #ff4488"
              : "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.22)",
            borderRadius: 4,
            cursor:
              state.status === "permission-pending" || state.status === "uploading" || state.status === "transcribing"
                ? "default"
                : "pointer",
            fontSize: 14,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {icon}
          {autoSendEnabled && !isRecording && state.status !== "permission-pending" && (
            <span
              style={{
                position: "absolute",
                bottom: -2,
                right: -2,
                fontSize: 8,
                color: "#ffc800",
                background: "var(--lim-bg, #0c1117)",
                borderRadius: 8,
                padding: "0 2px",
                lineHeight: 1,
                fontWeight: 700,
              }}
            >
              ⚡
            </span>
          )}
          {isRecording && (
            <span
              style={{
                position: "absolute",
                top: -3,
                right: -3,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#ff4488",
                boxShadow: "0 0 8px #ff4488",
                animation: "data-pulse 0.75s ease-in-out infinite",
              }}
            />
          )}
        </button>
        {isRecording && (
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#ff4488", minWidth: 36 }}>
            {formatMs(state.elapsedMs)}
          </span>
        )}
        {isRecording && (
          <button
            type="button"
            onClick={cancel}
            title="Discard recording (Esc Esc)"
            style={{
              padding: "2px 6px",
              fontSize: 10,
              background: "transparent",
              color: "rgba(217,226,236,0.5)",
              border: "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.15)",
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        )}
      </div>
      {!hideCostChip && state.lastCost && state.status === "done" && (
        <span
          style={{
            fontSize: 9,
            color: "rgba(217,226,236,0.45)",
            fontFamily: "monospace",
            whiteSpace: "nowrap",
          }}
          title={`Model: ${state.lastCost.model}\nLanguage: ${state.lastCost.language ?? "auto"}\nSession total: ${formatSec(state.sessionDurationSec)} / $${state.sessionCostUsd.toFixed(5)}`}
        >
          {state.lastCost.durationSec ? formatSec(state.lastCost.durationSec) : "?"} · ${state.lastCost.costUsd.toFixed(5)}
        </span>
      )}
      {state.status === "error" && state.error && (
        <span
          style={{
            fontSize: 9,
            color: "#ff8888",
            maxWidth: 220,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={state.error}
        >
          {state.error}
        </span>
      )}
    </div>
  );
};

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSec(sec: number): string {
  return formatMs(sec * 1000);
}
