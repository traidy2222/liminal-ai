/**
 * Live browser dictation with optional auto-send.
 *
 * THREE PARALLEL SUBSYSTEMS while recording:
 *
 *   1. **Web Speech API** (Chrome / Edge / Safari) — streams interim + final
 *      transcripts as the user speaks. Zero cost, near-zero latency. This is
 *      what makes dictation feel "live".
 *
 *   2. **MediaRecorder + Whisper** — captures the full clip in the background.
 *      On stop, uploads to /api/transcribe for a high-accuracy refinement that
 *      replaces the Web Speech draft.
 *
 *   3. **VAD** (Web Audio API RMS analyzer) — detects silence with 50ms
 *      resolution. Drives the optional auto-send state machine.
 *
 * AUTO-SEND STATE MACHINE (opt-in via `autoSend.enabled`):
 *
 *     listening                  (calibrating noise floor)
 *        ↓ first speech frame
 *     speaking                   (VAD says user is actively talking)
 *        ↓ silence > silenceMsToPause
 *     pausing                    (brief pause — could be mid-sentence)
 *        ↓ silence > adaptiveSilenceMs   AND   recordingMs > minRecordingMs
 *     ready_to_send              (countdown chip fires; user can cancel)
 *        ↓ no new speech during countdown
 *     firing                     (call onAutoSend; stop recording)
 *
 * Cancel paths (return to `speaking`):
 *   - New speech frame arrives during pausing/ready_to_send → reset timer
 *   - User presses Escape while recording → cancel pending send, stay recording
 *   - User clicks Cancel → discard everything
 *
 * EDGE CASES HANDLED:
 *   - Tab/window backgrounded: pause auto-send (visibilitychange)
 *   - Mic stream ends (OS interrupt, permission revoked): stop cleanly
 *   - Web Speech fails (NotAllowedError, network): continue with MediaRecorder
 *   - Recording shorter than minRecordingMs: don't auto-send (filter coughs)
 *   - Recording exceeds maxRecordingMs: hard-stop and send what we have
 *   - Audio cue requested: 100ms 880Hz tone via Web Audio (no asset needed)
 *   - Whisper refinement arrives AFTER auto-send: silent update via callback
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { WEB_SERVER_BASE } from "../useSSE.js";
import { createVad, type VadHandle } from "./vad.js";

export type DictationStatus =
  | "idle"
  | "permission-pending"
  | "recording"
  | "uploading"
  | "transcribing"
  | "done"
  | "error";

export interface DictationCost {
  durationSec?: number;
  costUsd: number;
  model: string;
  language?: string;
}

export interface AutoSendOptions {
  enabled: boolean;
  /** Min recording length before auto-send is even considered. Default 1500ms. */
  minRecordingMs?: number;
  /** Pause threshold (ms) for short utterances (< 5000ms recorded). Default 1500ms. */
  silenceMsShort?: number;
  /** Pause threshold for longer recordings. Default 2500ms. */
  silenceMsLong?: number;
  /** Hard cap on continuous recording. Default 60000ms. */
  maxRecordingMs?: number;
  /**
   * When true and Web Speech is available, require at least one `isFinal`
   * result before auto-send fires (means we have committed text to send).
   * Default true.
   */
  requireWebSpeechFinal?: boolean;
  /**
   * When true, play a brief 880Hz tone on auto-send so the user knows the
   * message went out. Default false.
   */
  audioCue?: boolean;
  /**
   * Reject auto-send if the transcript would be < N words. Filters out
   * "send" / "go" / single-cough scenarios. Default 2.
   */
  minWordCount?: number;
}

export interface DictationState {
  status: DictationStatus;
  elapsedMs: number;
  error: string | null;
  lastCost: DictationCost | null;
  sessionCostUsd: number;
  sessionDurationSec: number;
  supported: boolean;
  liveTranscriptionSupported: boolean;
  liveText: string;
  /** Whether auto-send mode is active for the current session. */
  autoSendActive: boolean;
  /** ms remaining until auto-send fires (when in pause countdown). */
  autoSendCountdownMs: number | null;
  /**
   * True during the first ~WARMUP_MS after recording starts. The stop button
   * is suppressed in this window to absorb accidental double-clicks (touch
   * devices, fast clickers, double-fire from React). Cancel (✕) stays active
   * so users can always bail.
   */
  warmingUp: boolean;
}

export interface UseDictationOptions {
  /**
   * Web Speech committed a final segment. Append to the input draft.
   * `cost` is null during recording; only populated for the very last final.
   */
  onFinal: (text: string, cost: DictationCost | null) => void;
  /** Web Speech interim hypothesis. Show as preview / replace last preview. */
  onInterim?: (text: string) => void;
  /**
   * Whisper returned a refined high-accuracy transcript. Consumer should
   * replace the entire dictation-session span with this text.
   * `wasAutoSent: true` means the message has already been sent — the
   * consumer should still update the DISPLAYED message but not re-send.
   */
  onWhisperRefinement?: (text: string, cost: DictationCost, wasAutoSent: boolean) => void;
  /**
   * Auto-send fired. Receives the current committed Web Speech text the
   * consumer should send. After this fires, recording stops and Whisper
   * refinement runs in the background; refinement arrives via
   * onWhisperRefinement with wasAutoSent=true.
   */
  onAutoSend?: (committedText: string) => void;
  /**
   * Callback for the live pause countdown — fires every ~100ms with ms
   * remaining until auto-send. Used by the button UI to render a chip.
   */
  onCountdown?: (msRemaining: number | null) => void;
  language?: string;
  prompt?: string;
  autoSend?: AutoSendOptions;
}

/** Web Speech API surface (typed inline — lib.dom doesn't ship globals). */
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike> & Iterable<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
  length: number;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const DEFAULT_AUTO_SEND: Required<Omit<AutoSendOptions, "enabled">> = {
  minRecordingMs: 1500,
  silenceMsShort: 1500,
  silenceMsLong: 2500,
  maxRecordingMs: 60_000,
  requireWebSpeechFinal: true,
  audioCue: false,
  minWordCount: 2,
};

/**
 * Disable the stop button for this many ms after recording starts. Absorbs
 * accidental double-clicks (the single most common "dictation stopped
 * immediately" failure mode — user clicks 🎤, button switches to ⏹, second
 * click registers as stop). Cancel (✕) is always available.
 */
const RECORDING_WARMUP_MS = 600;

export function useDictation(opts: UseDictationOptions): {
  state: DictationState;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
  /** Cancel any pending auto-send while keeping recording active. */
  cancelPendingAutoSend: () => void;
} {
  const speechCtor = getSpeechRecognitionCtor();
  const [state, setState] = useState<DictationState>({
    status: "idle",
    elapsedMs: 0,
    error: null,
    lastCost: null,
    sessionCostUsd: 0,
    sessionDurationSec: 0,
    supported:
      typeof window !== "undefined" &&
      typeof window.MediaRecorder !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia,
    liveTranscriptionSupported: speechCtor != null,
    liveText: "",
    autoSendActive: !!opts.autoSend?.enabled,
    autoSendCountdownMs: null,
    warmingUp: false,
  });

  // ── Refs (don't trigger re-renders on every audio frame) ────────────────
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const vadRef = useRef<VadHandle | null>(null);
  const committedTextRef = useRef("");
  const hasWebSpeechFinalRef = useRef(false);
  const autoSentRef = useRef(false);
  const optsRef = useRef(opts);
  const maxRecordingTimerRef = useRef<number | null>(null);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);
  /**
   * Marker for the warmup window — stop() consults this to refuse the rapid
   * second click that follows an accidental double-tap on the mic button.
   * Stored as a ref (not state) so the guard is synchronous and survives the
   * React render cycle.
   */
  const warmupUntilRef = useRef(0);
  const warmupTimerRef = useRef<number | null>(null);

  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  useEffect(() => {
    setState((s) => ({ ...s, autoSendActive: !!opts.autoSend?.enabled }));
  }, [opts.autoSend?.enabled]);

  // ── Cleanup helpers ─────────────────────────────────────────────────────
  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (tickerRef.current != null) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (maxRecordingTimerRef.current != null) {
      window.clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }
    if (warmupTimerRef.current != null) {
      window.clearTimeout(warmupTimerRef.current);
      warmupTimerRef.current = null;
    }
    warmupUntilRef.current = 0;
    chunksRef.current = [];
    recorderRef.current = null;
  }, []);

  const stopSpeech = useCallback(() => {
    if (speechRef.current) {
      try {
        speechRef.current.onresult = null;
        speechRef.current.onerror = null;
        speechRef.current.onend = null;
        speechRef.current.stop();
      } catch {
        /* ignore */
      }
      speechRef.current = null;
    }
  }, []);

  const stopVad = useCallback(() => {
    if (vadRef.current) {
      try {
        vadRef.current.stop();
      } catch {
        /* ignore */
      }
      vadRef.current = null;
    }
  }, []);

  const detachVisibilityHandler = useCallback(() => {
    if (visibilityHandlerRef.current) {
      document.removeEventListener("visibilitychange", visibilityHandlerRef.current);
      visibilityHandlerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupStream();
      stopSpeech();
      stopVad();
      detachVisibilityHandler();
    };
  }, [cleanupStream, stopSpeech, stopVad, detachVisibilityHandler]);

  // ── Auto-send mechanism ─────────────────────────────────────────────────
  /**
   * Compute the silence threshold for the current recording length. Short
   * utterances (< 5s) use the snappy threshold; longer recordings get more
   * room for natural mid-thought pauses.
   */
  function currentSilenceThreshold(): number {
    const a = { ...DEFAULT_AUTO_SEND, ...(optsRef.current.autoSend ?? {}) };
    const recordedMs = Date.now() - startedAtRef.current;
    return recordedMs < 5000 ? a.silenceMsShort : a.silenceMsLong;
  }

  function maybeFireAutoSend(): void {
    if (autoSentRef.current) return;
    const a = { ...DEFAULT_AUTO_SEND, ...(optsRef.current.autoSend ?? {}) };
    if (!a) return;
    if (!optsRef.current.autoSend?.enabled) return;

    const recordingMs = Date.now() - startedAtRef.current;
    if (recordingMs < a.minRecordingMs) return; // too short — filter coughs

    // If Web Speech is supported and we require finals, only fire when we
    // have at least one committed segment. (When Web Speech isn't supported,
    // auto-send waits for Whisper after stop, see uploadAndRefine path.)
    if (a.requireWebSpeechFinal && speechCtor && !hasWebSpeechFinalRef.current) return;

    const text = committedTextRef.current.trim();
    if (a.requireWebSpeechFinal && speechCtor) {
      // Word-count filter prevents accidental "send"/"go" auto-sends.
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length < a.minWordCount) return;
    }

    autoSentRef.current = true;
    setState((s) => ({ ...s, autoSendCountdownMs: null }));
    optsRef.current.onCountdown?.(null);

    // Optional audio cue — a brief 880Hz tone via Web Audio (no asset needed).
    if (a.audioCue) {
      playSendCue();
    }

    // Hand the committed text to the consumer; they decide whether to send
    // (typically yes, unless agent is busy in which case they refuse + we
    // keep listening).
    optsRef.current.onAutoSend?.(text);

    // Stop the recorder; Whisper refinement will run in background and arrive
    // via onWhisperRefinement(wasAutoSent=true).
    console.debug("[dictation] stop() ← maybeFireAutoSend at +" + (Date.now() - startedAtRef.current) + "ms");
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
    stopSpeech();
  }

  function handleSilenceTick(msSinceSpeech: number): void {
    if (autoSentRef.current) return;
    if (!optsRef.current.autoSend?.enabled) return;

    const a = { ...DEFAULT_AUTO_SEND, ...(optsRef.current.autoSend ?? {}) };
    const threshold = currentSilenceThreshold();
    const recordingMs = Date.now() - startedAtRef.current;

    if (recordingMs < a.minRecordingMs) {
      // Still in the min-recording window — no countdown yet.
      return;
    }

    // Once we cross the "starting to pause" line, surface a countdown so the
    // UI can show "auto-sending in 1.4s — keep talking to cancel".
    const remaining = threshold - msSinceSpeech;
    if (remaining > 0) {
      setState((s) =>
        s.autoSendCountdownMs === Math.ceil(remaining / 100) * 100
          ? s
          : { ...s, autoSendCountdownMs: remaining }
      );
      optsRef.current.onCountdown?.(remaining);
    } else {
      maybeFireAutoSend();
    }
  }

  function handleSpeechStart(): void {
    // Reset countdown — user resumed talking.
    if (state.autoSendCountdownMs != null) {
      setState((s) => ({ ...s, autoSendCountdownMs: null }));
      optsRef.current.onCountdown?.(null);
    }
  }

  // ── Web Speech wiring ───────────────────────────────────────────────────
  function startSpeechRecognition(language: string | undefined): void {
    if (!speechCtor) return;
    try {
      const rec = new speechCtor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      if (language) rec.lang = language;
      rec.onresult = (ev) => {
        let interim = "";
        let newFinals = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i]!;
          const txt = r[0]?.transcript ?? "";
          if (r.isFinal) newFinals += txt;
          else interim += txt;
        }
        if (newFinals) {
          const trimmed = newFinals.trim();
          if (trimmed) {
            const sep = committedTextRef.current && !/\s$/.test(committedTextRef.current) ? " " : "";
            committedTextRef.current = committedTextRef.current + sep + trimmed;
            hasWebSpeechFinalRef.current = true;
            optsRef.current.onFinal(trimmed, null);
            setState((s) => ({ ...s, liveText: committedTextRef.current }));
          }
        }
        if (interim) {
          setState((s) => ({ ...s, liveText: committedTextRef.current + " " + interim }));
          optsRef.current.onInterim?.(interim);
        }
      };
      rec.onerror = (ev) => {
        if (ev.error === "no-speech" || ev.error === "aborted") return;
        // Other errors (network, not-allowed): MediaRecorder will salvage the
        // clip and Whisper can still transcribe.
      };
      rec.onend = () => {
        // Browser will auto-end after extended silence even with continuous=true.
        // Restart if we're still recording AND haven't auto-sent.
        if (recorderRef.current?.state === "recording" && !autoSentRef.current) {
          try {
            rec.start();
          } catch {
            /* already ended */
          }
        }
      };
      speechRef.current = rec;
      rec.start();
    } catch {
      // NotAllowedError on some browsers — skip Web Speech; Whisper still works.
    }
  }

  // ── Recording lifecycle ─────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (!state.supported) {
      setState((s) => ({ ...s, status: "error", error: "Microphone not supported in this browser." }));
      return;
    }
    if (state.status === "recording" || state.status === "uploading" || state.status === "transcribing") {
      return;
    }
    setState((s) => ({ ...s, status: "permission-pending", error: null, liveText: "", autoSendCountdownMs: null }));
    committedTextRef.current = "";
    hasWebSpeechFinalRef.current = false;
    autoSentRef.current = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({
        ...s,
        status: "error",
        error: /permission|denied|notallowed/i.test(msg)
          ? "Microphone permission denied. Enable it in your browser's site settings."
          : `Could not access microphone: ${msg}`,
      }));
      return;
    }
    streamRef.current = stream;
    console.debug("[dictation] stream acquired:", {
      id: stream.id,
      active: stream.active,
      tracks: stream.getTracks().map((t) => ({
        id: t.id,
        kind: t.kind,
        label: t.label,
        readyState: t.readyState,
        enabled: t.enabled,
        muted: t.muted,
      })),
    });

    // Handle the user revoking permission / OS interrupt mid-recording.
    // Log loudly so we can see whether a track-end is the actual trigger of
    // surprise stops (the most common silent killer of MediaRecorder).
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => {
        console.warn("[dictation] TRACK ENDED:", {
          id: track.id,
          kind: track.kind,
          label: track.label,
          readyState: track.readyState,
          recorderState: recorderRef.current?.state,
          recordingMs: startedAtRef.current ? Date.now() - startedAtRef.current : null,
        });
        if (recorderRef.current?.state === "recording") {
          try {
            recorderRef.current.stop();
          } catch {
            /* ignore */
          }
        }
      });
      track.addEventListener("mute", () => {
        console.warn("[dictation] track muted:", track.id, "— this often precedes an ended event");
      });
    }

    // Tab background → cancel pending auto-send to avoid surprise sends when
    // the user isn't looking. Recording continues (the user could be doing a
    // hands-free workflow); only the auto-send heuristic pauses.
    const onVisibility = (): void => {
      if (document.hidden && state.autoSendCountdownMs != null) {
        setState((s) => ({ ...s, autoSendCountdownMs: null }));
        optsRef.current.onCountdown?.(null);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    visibilityHandlerRef.current = onVisibility;

    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    const mimeType = candidates.find((c) => window.MediaRecorder.isTypeSupported?.(c)) ?? "";
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    cancelledRef.current = false;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
        console.debug(
          `[dictation] dataavailable: ${e.data.size}B (chunk #${chunksRef.current.length}, +${Date.now() - startedAtRef.current}ms)`
        );
      }
    };

    recorder.onpause = () => {
      console.warn("[dictation] recorder PAUSED unexpectedly at +" + (Date.now() - startedAtRef.current) + "ms");
    };
    recorder.onresume = () => {
      console.debug("[dictation] recorder resumed at +" + (Date.now() - startedAtRef.current) + "ms");
    };

    // Surface MediaRecorder errors instead of swallowing them. The recorder
    // can fire `error` events asynchronously for codec issues, OS audio
    // glitches, or quota problems — without this handler, the recorder
    // silently transitions to "inactive" and the UI looks like dictation
    // turned itself off for no reason.
    recorder.onerror = (ev) => {
      const errEvent = ev as Event & { error?: { name?: string; message?: string } };
      const errInfo = errEvent.error;
      const msg = errInfo?.message ?? errInfo?.name ?? "MediaRecorder error";
      console.warn("[dictation] MediaRecorder error:", errInfo ?? ev);
      setState((s) => ({ ...s, status: "error", error: `Recording error: ${msg}` }));
      cleanupStream();
      stopSpeech();
      stopVad();
      detachVisibilityHandler();
    };

    recorder.onstop = () => {
      const elapsed = Date.now() - startedAtRef.current;
      const chunkBytes = chunksRef.current.reduce(
        (n, c) => n + (c instanceof Blob ? c.size : (c as ArrayBuffer).byteLength ?? 0),
        0
      );
      console.warn("[dictation] recorder ONSTOP fired", {
        elapsedMs: elapsed,
        wasCancelled: cancelledRef.current,
        wasAutoSent: autoSentRef.current,
        chunks: chunksRef.current.length,
        totalBytes: chunkBytes,
        // Stack trace shows WHO called stop — invaluable for diagnosing
        // surprise stops. Look for cancel() / maybeFireAutoSend() / max
        // recording timeout / track.ended in the trace.
        trace: new Error("onstop trace").stack?.split("\n").slice(1, 8).join("\n"),
      });
      stopVad();
      stopSpeech();
      detachVisibilityHandler();
      if (cancelledRef.current) {
        cleanupStream();
        setState((s) => ({ ...s, status: "idle", elapsedMs: 0, liveText: "", autoSendCountdownMs: null }));
        return;
      }
      const finalMime = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: finalMime });
      cleanupStream();
      void uploadAndRefine(blob, finalMime, optsRef.current, autoSentRef.current).then(
        (cost) => {
          setState((s) => ({
            ...s,
            status: "done",
            elapsedMs: 0,
            liveText: "",
            autoSendCountdownMs: null,
            lastCost: cost,
            sessionCostUsd: cost ? s.sessionCostUsd + (cost.costUsd || 0) : s.sessionCostUsd,
            sessionDurationSec: cost ? s.sessionDurationSec + (cost.durationSec || 0) : s.sessionDurationSec,
            error: null,
          }));
        },
        (err) => {
          setState((s) => ({
            ...s,
            status: state.liveTranscriptionSupported ? "done" : "error",
            elapsedMs: 0,
            liveText: "",
            autoSendCountdownMs: null,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      );
    };

    // MediaRecorder.start() can throw synchronously in some browsers when the
    // requested mime/codec isn't actually supported despite isTypeSupported's
    // earlier promise. Catch that path explicitly — otherwise the recorder
    // silently enters "inactive" state and the UI looks frozen.
    try {
      recorder.start(1000);
    } catch (err) {
      console.warn("[dictation] recorder.start() threw:", err);
      setState((s) => ({
        ...s,
        status: "error",
        error: `Recording could not start: ${err instanceof Error ? err.message : String(err)}`,
      }));
      cleanupStream();
      detachVisibilityHandler();
      return;
    }
    startedAtRef.current = Date.now();
    // Warmup window — absorb accidental double-clicks from touch devices /
    // fast-click users so the second click doesn't immediately stop recording.
    warmupUntilRef.current = startedAtRef.current + RECORDING_WARMUP_MS;
    warmupTimerRef.current = window.setTimeout(() => {
      setState((s) => ({ ...s, warmingUp: false }));
      warmupTimerRef.current = null;
    }, RECORDING_WARMUP_MS);
    tickerRef.current = window.setInterval(() => {
      setState((s) => ({ ...s, elapsedMs: Date.now() - startedAtRef.current }));
    }, 200);

    // Hard cap on continuous recording so a stuck mic doesn't run forever.
    const a = { ...DEFAULT_AUTO_SEND, ...(opts.autoSend ?? {}) };
    maxRecordingTimerRef.current = window.setTimeout(() => {
      if (recorderRef.current?.state === "recording") {
        console.warn("[dictation] stop() ← maxRecordingMs timeout (" + a.maxRecordingMs + "ms)");
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
    }, a.maxRecordingMs);

    setState((s) => ({ ...s, status: "recording", elapsedMs: 0, error: null, warmingUp: true }));

    // Web Speech in parallel for live transcript display.
    startSpeechRecognition(opts.language);

    // VAD in parallel for auto-send pause detection (only when needed).
    if (opts.autoSend?.enabled) {
      vadRef.current = createVad({
        stream,
        onSpeechStart: handleSpeechStart,
        onSpeechEnd: () => {
          /* handled via onSilenceTick */
        },
        onSilenceTick: handleSilenceTick,
        onError: () => {
          /* VAD failure isn't fatal — auto-send just won't trigger */
        },
      });
    }
  }, [state.supported, state.status, state.liveTranscriptionSupported, state.autoSendCountdownMs, cleanupStream, stopSpeech, stopVad, detachVisibilityHandler, opts.language, opts.autoSend?.enabled]);

  const stop = useCallback(async () => {
    const r = recorderRef.current;
    if (!r) return;
    if (r.state === "inactive") return;
    // Warmup guard — refuse stop() within the first RECORDING_WARMUP_MS so
    // a double-click on the mic button can't immediately end the take.
    // Cancel() (the ✕ button) deliberately skips this check so users can
    // always bail out instantly.
    if (Date.now() < warmupUntilRef.current) {
      console.debug(
        `[dictation] ignoring stop() during warmup (${Math.round(warmupUntilRef.current - Date.now())}ms remaining)`
      );
      return;
    }
    setState((s) => ({ ...s, status: "uploading", autoSendCountdownMs: null }));
    stopVad();
    stopSpeech();
    r.stop();
  }, [stopSpeech, stopVad]);

  const cancel = useCallback(() => {
    const r = recorderRef.current;
    cancelledRef.current = true;
    autoSentRef.current = false;
    if (r && r.state !== "inactive") r.stop();
    cleanupStream();
    stopSpeech();
    stopVad();
    detachVisibilityHandler();
    setState((s) => ({
      ...s,
      status: "idle",
      elapsedMs: 0,
      error: null,
      liveText: "",
      autoSendCountdownMs: null,
    }));
  }, [cleanupStream, stopSpeech, stopVad, detachVisibilityHandler]);

  const cancelPendingAutoSend = useCallback(() => {
    if (state.autoSendCountdownMs != null) {
      setState((s) => ({ ...s, autoSendCountdownMs: null }));
      optsRef.current.onCountdown?.(null);
    }
  }, [state.autoSendCountdownMs]);

  // Whisper upload + refinement. `wasAutoSent` propagates through so the
  // consumer can update a sent message's displayed text without re-sending.
  async function uploadAndRefine(
    blob: Blob,
    mimeType: string,
    o: UseDictationOptions,
    wasAutoSent: boolean
  ): Promise<DictationCost | null> {
    if (blob.size < 500) return null; // too short for Whisper
    setState((s) => ({ ...s, status: "uploading" }));
    const dataUrl = await blobToDataUrl(blob);
    const filename = `dictation-${Date.now()}.${extForMime(mimeType)}`;
    const uploadResp = await fetch(`${WEB_SERVER_BASE}/api/audio/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl, filename, mimeType }),
    });
    if (!uploadResp.ok) {
      const j = (await uploadResp.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `Upload failed: HTTP ${uploadResp.status}`);
    }
    const uploadBody = (await uploadResp.json()) as { attachmentId: string };
    setState((s) => ({ ...s, status: "transcribing" }));
    const tResp = await fetch(`${WEB_SERVER_BASE}/api/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attachmentId: uploadBody.attachmentId,
        language: o.language,
        prompt: o.prompt,
      }),
    });
    if (!tResp.ok) {
      const j = (await tResp.json().catch(() => ({}))) as { error?: string };
      if (tResp.status === 503) return null; // no API key — Web Speech text stands
      throw new Error(j.error ?? `Transcription failed: HTTP ${tResp.status}`);
    }
    const tBody = (await tResp.json()) as {
      text: string;
      language?: string;
      durationSec?: number;
      costUsd: number;
      model: string;
    };
    const cost: DictationCost = {
      durationSec: tBody.durationSec,
      costUsd: tBody.costUsd,
      model: tBody.model,
      language: tBody.language,
    };
    if (tBody.text.trim()) {
      o.onWhisperRefinement?.(tBody.text.trim(), cost, wasAutoSent);
    }
    return cost;
  }

  return { state, start, stop, cancel, cancelPendingAutoSend };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "bin";
}

/** Brief 880Hz sine tone via Web Audio — no asset, no network, no permission. */
function playSendCue(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.001; // start near silent
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
    gain.gain.linearRampToValueAtTime(0.0001, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.13);
    osc.onended = () => {
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    };
  } catch {
    /* audio cue is best-effort */
  }
}
