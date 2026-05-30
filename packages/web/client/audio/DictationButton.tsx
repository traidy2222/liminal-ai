import React, { useCallback, useEffect } from "react";
import { useDictation, type DictationCost } from "./useDictation.js";

/**
 * Mic button — continuous listening session with VAD-triggered utterances.
 *
 * Click 🎤 once to arm the mic (stays on). Speak → records → pause sends.
 * Click 🎤 again to turn the session off. While recording, ⏹ sends immediately.
 */
export interface DictationButtonProps {
  onAppendFinal: (text: string) => void;
  onInterimText: (text: string) => void;
  onRefinedFull: (text: string, cost: DictationCost, wasAutoSent: boolean) => void;
  onAutoSend: (text: string) => void;
  /** Fired at the start of each spoken utterance (for cursor / span snapshot). */
  onStart?: () => void;
  /** Fired when the continuous listening session arms or disarms. */
  onSessionActiveChange?: (active: boolean) => void;
  /** Fired when uploading/transcribing dictation — pause agent TTS (not while merely recording). */
  onCaptureActiveChange?: (active: boolean) => void;
  /** Suppress VAD utterance starts while agent TTS is playing (speaker bleed guard). */
  shouldBlockSpeechCapture?: () => boolean;
  audioCue?: boolean;
  minRecordingMs?: number;
  silenceMsShort?: number;
  silenceMsLong?: number;
  maxRecordingMs?: number;
  language?: string;
  prompt?: string;
  hideCostChip?: boolean;
  className?: string;
  placement?: "floating" | "composer";
}

export const DictationButton: React.FC<DictationButtonProps> = ({
  onAppendFinal,
  onInterimText,
  onRefinedFull,
  onAutoSend,
  onStart,
  onSessionActiveChange,
  onCaptureActiveChange,
  shouldBlockSpeechCapture,
  audioCue = false,
  minRecordingMs,
  silenceMsShort,
  silenceMsLong,
  maxRecordingMs,
  language,
  prompt,
  hideCostChip,
  className,
  placement = "floating",
}) => {
  const { state, start, endSession, stop, cancel, cancelPendingAutoSend } = useDictation({
    onFinal: (text) => onAppendFinal(text),
    onInterim: (text) => onInterimText(text),
    onWhisperRefinement: (text, cost, sent) => onRefinedFull(text, cost, sent),
    onAutoSend,
    onUtteranceStart: onStart,
    shouldBlockSpeechCapture,
    language,
    prompt,
    endpoint: {
      ...(audioCue ? { audioCue: true } : {}),
      ...(minRecordingMs !== undefined ? { minRecordingMs } : {}),
      ...(silenceMsShort !== undefined ? { silenceMsShort } : {}),
      ...(silenceMsLong !== undefined ? { silenceMsLong } : {}),
      ...(maxRecordingMs !== undefined ? { maxRecordingMs } : {}),
    },
  });

  const isRecording = state.status === "recording";
  const isListening = state.status === "listening";
  const sessionActive = state.sessionActive;

  useEffect(() => {
    onSessionActiveChange?.(sessionActive);
  }, [sessionActive, onSessionActiveChange]);

  useEffect(() => {
    const capture = state.status === "uploading" || state.status === "transcribing";
    onCaptureActiveChange?.(capture);
  }, [state.status, onCaptureActiveChange]);

  useEffect(() => {
    if (!sessionActive) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (isRecording && state.autoSendCountdownMs != null) {
        e.preventDefault();
        cancelPendingAutoSend();
      } else {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionActive, isRecording, state.autoSendCountdownMs, cancel, cancelPendingAutoSend]);

  const onClickMic = useCallback(() => {
    if (isRecording) {
      if (state.warmingUp) {
        console.debug("[dictation] mic click ignored during warmup");
        return;
      }
      void stop();
      return;
    }
    if (isListening) {
      endSession();
      return;
    }
    if (state.status === "idle" || state.status === "done" || state.status === "error") {
      void start();
    }
  }, [isRecording, isListening, state.warmingUp, state.status, start, stop, endSession]);

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

  let icon = "🎤";
  let title = "Click to turn on voice input (stays on until you click again)";
  let color = "rgba(217,226,236,0.6)";
  let bg = "transparent";
  if (state.status === "permission-pending") {
    icon = "⏳";
    title = "Waiting for microphone permission…";
  } else if (isListening) {
    icon = "🎤";
    title = "Listening — speak when ready. Click mic to turn off.";
    color = "#66ff99";
    bg = "rgba(102,255,153,0.12)";
  } else if (isRecording) {
    icon = "⏹";
    title = state.liveTranscriptionSupported
      ? "Speaking — pause to send, or click to send now. Click mic (when idle) to turn off session."
      : "Speaking — pause to send. Click ⏹ to finish.";
    color = "#ff4488";
    bg = "rgba(255,68,136,0.12)";
  } else if (state.status === "uploading" || state.status === "transcribing") {
    icon = "⟳";
    title = "Refining last clip in background — still listening.";
    color = "var(--lim-accent, #00d4ff)";
  } else if (state.status === "error") {
    icon = "⚠";
    title = state.error ?? "Dictation error";
    color = "#ff8888";
  }

  const countdownSecs =
    state.autoSendCountdownMs != null ? (state.autoSendCountdownMs / 1000).toFixed(1) : null;

  const inComposer = placement === "composer";

  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        flexDirection: inComposer ? "row" : "column",
        alignItems: inComposer ? "center" : "flex-end",
        gap: inComposer ? 6 : 3,
        position: "relative",
        flexShrink: 0,
      }}
    >
      {countdownSecs && (
        <div
          style={{
            position: inComposer ? "absolute" : undefined,
            bottom: inComposer ? "calc(100% + 6px)" : undefined,
            left: inComposer ? 0 : undefined,
            right: inComposer ? 0 : undefined,
            padding: "4px 10px",
            background: "rgba(255,68,136,0.18)",
            color: "#ff4488",
            border: "1px solid rgba(255,68,136,0.5)",
            borderRadius: inComposer ? 6 : 3,
            fontSize: 10,
            fontFamily: "monospace",
            fontWeight: 600,
            whiteSpace: inComposer ? "normal" : "nowrap",
            animation: "data-pulse 0.5s ease-in-out infinite",
            zIndex: 2,
          }}
        >
          Sending in {countdownSecs}s · keep talking or Esc to cancel
        </div>
      )}

      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <button
          type="button"
          onClick={onClickMic}
          disabled={
            state.status === "permission-pending" ||
            state.status === "uploading" ||
            state.status === "transcribing"
          }
          title={title}
          aria-label={title}
          style={{
            width: 32,
            height: 28,
            background: bg,
            color,
            border:
              isRecording
                ? "1px solid #ff4488"
                : isListening
                  ? "1px solid #66ff99"
                  : "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.22)",
            borderRadius: 4,
            cursor:
              state.status === "permission-pending" ||
              state.status === "uploading" ||
              state.status === "transcribing"
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
          {(isListening || isRecording) && (
            <span
              style={{
                position: "absolute",
                top: -3,
                right: -3,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: isRecording ? "#ff4488" : "#66ff99",
                boxShadow: isRecording ? "0 0 8px #ff4488" : "0 0 8px #66ff99",
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
        {sessionActive && (
          <button
            type="button"
            onClick={cancel}
            title={isRecording ? "Discard this phrase (Esc)" : "Turn off voice input (Esc)"}
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
      {!hideCostChip && state.lastCost && state.status === "done" && !sessionActive && (
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
