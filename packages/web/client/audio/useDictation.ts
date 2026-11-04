/** Local dictation: neural-gated ASR previews, VAD endpoints, one authoritative final take. */
import { useCallback, useEffect, useRef, useState } from "react";
import { WEB_SERVER_BASE } from "../useSSE.js";
import { webApiFetch } from "../webApiAuth.js";
import { LocalPreview } from "./localPreview.js";
import { createVad, type VadHandle } from "./vad.js";

export type DictationStatus =
  | "idle"
  | "permission-pending"
  /** Mic session on — stream + VAD armed; records only when speech is detected. */
  | "listening"
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

/** Pause-detection tuning (silence thresholds, caps, optional send tone). */
export interface DictationEndpointOptions {
  /** Min recording length before pause-send is considered. Default 1500ms. */
  minRecordingMs?: number;
  /** Pause threshold (ms) for short utterances (< 5000ms recorded). Default 1500ms. */
  silenceMsShort?: number;
  /** Pause threshold for longer recordings. Default 2500ms. */
  silenceMsLong?: number;
  /** Hard cap on continuous recording. Default 60000ms. */
  maxRecordingMs?: number;
  /**
   * When true and Web Speech is available, require at least one `isFinal`
   * before pause-send (committed text). Default true.
   */
  requireWebSpeechFinal?: boolean;
  /** Play a brief 880Hz tone when the message is sent. Default false. */
  audioCue?: boolean;
  /** Min words when Web Speech is active (filters coughs). Default 2. */
  minWordCount?: number;
}

/** @deprecated Use DictationEndpointOptions */
export type AutoSendOptions = DictationEndpointOptions & { enabled?: boolean };

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
  /** Mic session armed (listening or actively recording an utterance). */
  sessionActive: boolean;
  /** ms remaining until pause-send fires (countdown chip). */
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
   * The complete local transcript is ready. Append to the input draft.
   * `cost` is null during recording; only populated for the very last final.
   */
  onFinal: (text: string, cost: DictationCost | null) => void;
  /** Provisional local hypothesis. Show as preview; never send it as final. */
  onInterim?: (text: string) => void;
  /**
   * Whisper returned a refined high-accuracy transcript. Consumer should
   * replace the entire dictation-session span with this text.
   * `wasAutoSent: true` means the message has already been sent — the
   * consumer should still update the DISPLAYED message but not re-send.
   */
  onWhisperRefinement?: (text: string, cost: DictationCost, wasAutoSent: boolean) => void;
  /**
   * Pause or manual stop fired — consumer sends this text to the agent.
   * Recording stops; Whisper refinement may follow via onWhisperRefinement.
   */
  onAutoSend?: (committedText: string) => void;
  /** Pause-detection tuning; always active while recording. */
  endpoint?: DictationEndpointOptions;
  /** @deprecated Use `endpoint` */
  autoSend?: DictationEndpointOptions & { enabled?: boolean };
  /**
   * Callback for the live pause countdown — fires every ~100ms with ms
   * remaining until auto-send. Used by the button UI to render a chip.
   */
  onCountdown?: (msRemaining: number | null) => void;
  /** Fired when VAD detects speech and a new utterance starts (each turn). */
  onUtteranceStart?: () => void;
  /**
   * When true, VAD must not start a new utterance (agent TTS playing — avoids
   * speaker bleed arming the mic and cutting playback).
   */
  shouldBlockSpeechCapture?: () => boolean;
  language?: string;
  prompt?: string;
}

/** @deprecated Browser-vendor speech has been replaced by local transcription. */
export function setDictationWebSpeechEnabled(_on: boolean): void {}

const DEFAULT_ENDPOINT: Required<DictationEndpointOptions> = {
  minRecordingMs: 1500,
  silenceMsShort: 1500,
  silenceMsLong: 2500,
  maxRecordingMs: 60_000,
  requireWebSpeechFinal: false,
  audioCue: false,
  minWordCount: 2,
};

/** Spread only defined keys — explicit `undefined` must not erase defaults. */
function pickDefinedEndpoint(
  partial: DictationEndpointOptions | undefined
): Partial<DictationEndpointOptions> {
  if (!partial) return {};
  const out: Partial<DictationEndpointOptions> = {};
  if (partial.minRecordingMs !== undefined) out.minRecordingMs = partial.minRecordingMs;
  if (partial.silenceMsShort !== undefined) out.silenceMsShort = partial.silenceMsShort;
  if (partial.silenceMsLong !== undefined) out.silenceMsLong = partial.silenceMsLong;
  if (partial.maxRecordingMs !== undefined) out.maxRecordingMs = partial.maxRecordingMs;
  if (partial.requireWebSpeechFinal !== undefined) {
    out.requireWebSpeechFinal = partial.requireWebSpeechFinal;
  }
  if (partial.audioCue !== undefined) out.audioCue = partial.audioCue;
  if (partial.minWordCount !== undefined) out.minWordCount = partial.minWordCount;
  return out;
}

function mergeEndpointOptions(opts: UseDictationOptions): Required<DictationEndpointOptions> {
  const { enabled: _legacyOff, ...legacy } = opts.autoSend ?? {};
  return {
    ...DEFAULT_ENDPOINT,
    ...pickDefinedEndpoint(legacy),
    ...pickDefinedEndpoint(opts.endpoint),
  };
}

/**
 * Disable the stop button for this many ms after recording starts. Absorbs
 * accidental double-clicks (the single most common "dictation stopped
 * immediately" failure mode — user clicks 🎤, button switches to ⏹, second
 * click registers as stop). Cancel (✕) is always available.
 */
const RECORDING_WARMUP_MS = 600;

export function useDictation(opts: UseDictationOptions): {
  state: DictationState;
  /** Open mic session (listen for speech; stays on until endSession). */
  start: () => Promise<void>;
  /** Turn mic session off. */
  endSession: () => void;
  stop: () => Promise<void>;
  cancel: () => void;
  cancelPendingAutoSend: () => void;
} {
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
    liveTranscriptionSupported: true,
    liveText: "",
    sessionActive: false,
    autoSendCountdownMs: null,
    warmingUp: false,
  });

  // ── Refs (don't trigger re-renders on every audio frame) ────────────────
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickerRef = useRef<number | null>(null);
  const vadRef = useRef<VadHandle | null>(null);
  const autoSentRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const utteranceActiveRef = useRef(false);
  const utteranceCancelledRef = useRef(false);
  const beginningUtteranceRef = useRef(false);
  const mimeTypeRef = useRef("");
  const optsRef = useRef(opts);
  const sessionAbortRef = useRef(new AbortController());
  const previewRef = useRef<LocalPreview | null>(null);
  if (!previewRef.current) previewRef.current = new LocalPreview(async (previewWav, signal) => {
    const response = await webApiFetch(`${WEB_SERVER_BASE}/api/transcribe`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ previewWav, language: optsRef.current.language }),
    });
    if (!response.ok) throw new Error(`Preview HTTP ${response.status}`);
    const result = await response.json() as { text: string };
    return result.text;
  }, text => {
    if (utteranceActiveRef.current && !autoSentRef.current) {
      setState(s => ({ ...s, liveText: text })); optsRef.current.onInterim?.(text);
    }
  });

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

  const stopVad = useCallback(() => {
    previewRef.current?.reset(true);
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
      sessionActiveRef.current = false;
      sessionAbortRef.current.abort();
      cleanupStream();
      stopVad();
      detachVisibilityHandler();
    };
  }, [cleanupStream, stopVad, detachVisibilityHandler]);

  function resetUtteranceDraftRefs(): void {
    previewRef.current?.reset();
    autoSentRef.current = false;
  }

  function returnToListening(): void {
    utteranceActiveRef.current = false;
    vadRef.current?.resetUtterance();
    resetUtteranceDraftRefs();
    if (maxRecordingTimerRef.current != null) {
      window.clearTimeout(maxRecordingTimerRef.current);
      maxRecordingTimerRef.current = null;
    }
    if (tickerRef.current != null) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    warmupUntilRef.current = 0;
    recorderRef.current = null;
    chunksRef.current = [];
    if (sessionActiveRef.current) {
      setState((s) => ({
        ...s,
        status: "listening",
        elapsedMs: 0,
        liveText: "",
        sessionActive: true,
        autoSendCountdownMs: null,
        warmingUp: false,
      }));
    }
  }

  function stopRecorderForEndpoint(): void {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
  }

  // ── Pause detection → send ──────────────────────────────────────────────
  function currentSilenceThreshold(): number {
    const a = mergeEndpointOptions(optsRef.current);
    const recordedMs = Date.now() - startedAtRef.current;
    return recordedMs < 5000 ? a.silenceMsShort : a.silenceMsLong;
  }

  /**
   * End the take and send to the agent when pause thresholds are met, or when
   * `force` (mic stop click). Returns true if recording was ended for send.
   */
  function tryEndpointSend(options?: { force?: boolean; silenceDeadline?: boolean }): boolean {
    if (autoSentRef.current) return true;
    const endpoint = mergeEndpointOptions(optsRef.current);
    const elapsed = Date.now() - startedAtRef.current;
    if (!options?.force && elapsed < endpoint.minRecordingMs) return false;
    if (elapsed < 250) return false;
    autoSentRef.current = true;
    setState(s => ({ ...s, autoSendCountdownMs: null }));
    optsRef.current.onCountdown?.(null);
    if (endpoint.audioCue) playSendCue();
    stopRecorderForEndpoint();
    return true;
  }

  function handleSilenceTick(msSinceSpeech: number): void {
    if (!utteranceActiveRef.current || autoSentRef.current) return;

    const a = mergeEndpointOptions(optsRef.current);
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
      setState((s) => ({ ...s, autoSendCountdownMs: null }));
      optsRef.current.onCountdown?.(null);
      if (!tryEndpointSend({ silenceDeadline: true })) {
        if (!tryEndpointSend({ force: true })) {
          console.debug("[dictation] pause deadline: no sendable draft yet");
        }
      }
    }
  }

  function handleSpeechResume(): void {
    setState((s) =>
      s.autoSendCountdownMs != null ? { ...s, autoSendCountdownMs: null } : s
    );
    optsRef.current.onCountdown?.(null);
  }

  function wireRecorderOnStop(recorder: MediaRecorder, mimeType: string, chunks: BlobPart[], sessionSignal: AbortSignal): void {
    recorder.onstop = () => {
      if (sessionSignal.aborted) return;
      const elapsed = Date.now() - startedAtRef.current;
      console.warn("[dictation] recorder ONSTOP fired", {
        elapsedMs: elapsed,
        utteranceCancelled: utteranceCancelledRef.current,
        wasAutoSent: autoSentRef.current,
        sessionActive: sessionActiveRef.current,
      });
      if (utteranceCancelledRef.current) {
        utteranceCancelledRef.current = false;
        returnToListening();
        return;
      }
      const finalMime = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: finalMime });
      const wasSent = autoSentRef.current;
      if (sessionActiveRef.current) {
        previewRef.current?.reset();
        if (maxRecordingTimerRef.current != null) window.clearTimeout(maxRecordingTimerRef.current);
        if (tickerRef.current != null) window.clearInterval(tickerRef.current);
        setState(s => ({ ...s, status: "uploading", liveText: "", autoSendCountdownMs: null, warmingUp: false }));
        void uploadAndRefine(blob, finalMime, optsRef.current, wasSent, sessionSignal).then(
          (cost) => {
            if (!cost || sessionSignal.aborted) return;
            setState((s) => ({
              ...s,
              lastCost: cost,
              sessionCostUsd: s.sessionCostUsd + (cost.costUsd || 0),
              sessionDurationSec: s.sessionDurationSec + (cost.durationSec || 0),
            }));
          },
          (err) => {
            if (!sessionActiveRef.current || sessionSignal.aborted) return;
            setState((s) => ({ ...s, status: "error", error: err instanceof Error ? err.message : String(err) }));
          }
        ).finally(() => {
          if (sessionActiveRef.current && !sessionSignal.aborted) returnToListening();
        });
        return;
      }
      cleanupStream();
      void uploadAndRefine(blob, finalMime, optsRef.current, wasSent, sessionSignal).then(
        (cost) => {
          setState((s) => ({
            ...s,
            status: "done",
            elapsedMs: 0,
            liveText: "",
            sessionActive: false,
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
            sessionActive: false,
            autoSendCountdownMs: null,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      );
    };
  }

  const beginUtterance = useCallback(async () => {
    if (!sessionActiveRef.current || utteranceActiveRef.current || !streamRef.current) return;
    if (beginningUtteranceRef.current) return;
    beginningUtteranceRef.current = true;
    try {
      resetUtteranceDraftRefs();
      utteranceCancelledRef.current = false;
      const stream = streamRef.current;
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mimeType =
        mimeTypeRef.current ||
        candidates.find((c) => window.MediaRecorder.isTypeSupported?.(c)) ||
        "";
      mimeTypeRef.current = mimeType;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      chunksRef.current = chunks;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onerror = (ev) => {
        const errEvent = ev as Event & { error?: { name?: string; message?: string } };
        const msg = errEvent.error?.message ?? errEvent.error?.name ?? "MediaRecorder error";
        endSessionRef.current();
        setState((s) => ({ ...s, status: "error", error: `Recording error: ${msg}` }));
      };
      wireRecorderOnStop(recorder, mimeType, chunks, sessionAbortRef.current.signal);
      try {
        recorder.start(1000);
      } catch (err) {
        setState((s) => ({
          ...s,
          status: "error",
          error: `Recording could not start: ${err instanceof Error ? err.message : String(err)}`,
        }));
        return;
      }
      utteranceActiveRef.current = true;
      startedAtRef.current = Date.now();
      warmupUntilRef.current = startedAtRef.current + RECORDING_WARMUP_MS;
      warmupTimerRef.current = window.setTimeout(() => {
        setState((s) => ({ ...s, warmingUp: false }));
        warmupTimerRef.current = null;
      }, RECORDING_WARMUP_MS);
      tickerRef.current = window.setInterval(() => {
        setState((s) => ({ ...s, elapsedMs: Date.now() - startedAtRef.current }));
      }, 200);
      const endpointOpts = mergeEndpointOptions(optsRef.current);
      const maxMs = Math.max(5_000, endpointOpts.maxRecordingMs);
      maxRecordingTimerRef.current = window.setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          if (!tryEndpointSend({ force: true })) {
            try {
              recorderRef.current.stop();
            } catch {
              /* ignore */
            }
          }
        }
      }, maxMs);
      setState((s) => ({
        ...s,
        status: "recording",
        elapsedMs: 0,
        error: null,
        sessionActive: true,
        warmingUp: true,
        autoSendCountdownMs: null,
      }));
      optsRef.current.onUtteranceStart?.();
      // Local preview is provisional. Only the complete take may auto-send.
      // Browser Web Speech is no longer used by the default local pipeline.
    } finally {
      beginningUtteranceRef.current = false;
    }
  }, []);

  const endSessionRef = useRef<() => void>(() => {});

  const endSession = useCallback(() => {
    sessionAbortRef.current.abort();
    previewRef.current?.reset(true);
    sessionActiveRef.current = false;
    utteranceActiveRef.current = false;
    utteranceCancelledRef.current = false;
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      utteranceCancelledRef.current = true;
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
    cleanupStream();
    stopVad();
    detachVisibilityHandler();
    setState((s) => ({
      ...s,
      status: "idle",
      elapsedMs: 0,
      error: null,
      liveText: "",
      sessionActive: false,
      autoSendCountdownMs: null,
      warmingUp: false,
    }));
  }, [cleanupStream, stopVad, detachVisibilityHandler]);

  endSessionRef.current = endSession;

  // ── Mic session (stays on until endSession) ─────────────────────────────
  const start = useCallback(async () => {
    if (!state.supported) {
      setState((s) => ({ ...s, status: "error", error: "Microphone not supported in this browser." }));
      return;
    }
    if (
      state.status === "recording" ||
      state.status === "listening" ||
      state.status === "permission-pending"
    ) {
      return;
    }
    setState((s) => ({
      ...s,
      status: "permission-pending",
      error: null,
      liveText: "",
      autoSendCountdownMs: null,
    }));
    resetUtteranceDraftRefs();
    sessionActiveRef.current = true;
    sessionAbortRef.current = new AbortController();

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
      sessionActiveRef.current = false;
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({
        ...s,
        status: "error",
        sessionActive: false,
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
        endSessionRef.current();
      });
      track.addEventListener("mute", () => {
        console.warn("[dictation] track muted:", track.id, "— this often precedes an ended event");
      });
    }

    const onVisibility = (): void => {
      if (document.hidden) {
        setState((s) =>
          s.autoSendCountdownMs != null ? { ...s, autoSendCountdownMs: null } : s
        );
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
    mimeTypeRef.current = candidates.find((c) => window.MediaRecorder.isTypeSupported?.(c)) ?? "";

    vadRef.current = createVad({
      onPcm: (samples, sampleRate) => {
        if (utteranceActiveRef.current && !autoSentRef.current && !optsRef.current.shouldBlockSpeechCapture?.()) previewRef.current?.push(samples, sampleRate);
      },
      stream,
      onSpeechStart: () => {
        if (optsRef.current.shouldBlockSpeechCapture?.()) {
          return;
        }
        if (sessionActiveRef.current && !utteranceActiveRef.current) {
          void beginUtterance();
          return;
        }
        handleSpeechResume();
      },
      onSpeechEnd: () => {
        /* handled via onSilenceTick */
      },
      onSilenceTick: handleSilenceTick,
      onError: () => {
        /* VAD failure isn't fatal */
      },
    });

    setState((s) => ({
      ...s,
      status: "listening",
      elapsedMs: 0,
      error: null,
      sessionActive: true,
      warmingUp: false,
      autoSendCountdownMs: null,
    }));
  }, [state.supported, state.status, beginUtterance, cleanupStream, stopVad, detachVisibilityHandler]);

  const stop = useCallback(async () => {
    const r = recorderRef.current;
    if (!r || r.state === "inactive") return;
    if (Date.now() < warmupUntilRef.current) {
      console.debug(
        `[dictation] ignoring stop() during warmup (${Math.round(warmupUntilRef.current - Date.now())}ms remaining)`
      );
      return;
    }
    if (tryEndpointSend({ force: true })) return;
    setState((s) => ({ ...s, status: "uploading", autoSendCountdownMs: null }));
    r.stop();
  }, []);

  const cancel = useCallback(() => {
    if (utteranceActiveRef.current) {
      utteranceCancelledRef.current = true;
      autoSentRef.current = false;
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        try {
          r.stop();
        } catch {
          /* ignore */
        }
      } else {
        returnToListening();
      }
      return;
    }
    endSession();
  }, [endSession]);

  const cancelPendingAutoSend = useCallback(() => {
    if (state.autoSendCountdownMs != null) {
      setState((s) => ({ ...s, autoSendCountdownMs: null }));
      optsRef.current.onCountdown?.(null);
    }
  }, [state.autoSendCountdownMs]);

  // One authoritative final transcription. Provisional text is never sent.
  async function uploadAndRefine(
    blob: Blob,
    mimeType: string,
    o: UseDictationOptions,
    _wasAutoSent: boolean,
    sessionSignal: AbortSignal
  ): Promise<DictationCost | null> {
    const signal = AbortSignal.any([sessionSignal, AbortSignal.timeout(150_000)]);
    signal.throwIfAborted();
    if (blob.size < 500) return null; // too short for Whisper
    const keepListening = sessionActiveRef.current;
    if (!keepListening) setState((s) => ({ ...s, status: "uploading" }));
    const dataUrl = await blobToDataUrl(blob);
    const filename = `dictation-${Date.now()}.${extForMime(mimeType)}`;
    const baseMime = mimeType.split(";")[0]?.trim().toLowerCase() || "audio/webm";
    const uploadResp = await webApiFetch(`${WEB_SERVER_BASE}/api/audio/upload`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl, filename, mimeType: baseMime }),
    });
    if (!uploadResp.ok) {
      const j = (await uploadResp.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `Upload failed: HTTP ${uploadResp.status}`);
    }
    const uploadBody = (await uploadResp.json()) as { attachmentId: string };
    signal.throwIfAborted();
    setState((s) => ({ ...s, status: "transcribing" }));
    const tResp = await webApiFetch(`${WEB_SERVER_BASE}/api/transcribe`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attachmentId: uploadBody.attachmentId,
        language: o.language,
        prompt: o.prompt,
      }),
    });
    if (!tResp.ok) {
      const j = (await tResp.json().catch(() => ({}))) as { error?: string };
      // Setup/runtime errors must reach the user; never silently discard dictation.
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
    const refined = tBody.text.trim();
    if (refined && sessionActiveRef.current && !signal.aborted) {
      if (o.onAutoSend) {
        o.onAutoSend(refined);
        o.onWhisperRefinement?.(refined, cost, true);
      } else if (o.onWhisperRefinement) {
        o.onWhisperRefinement(refined, cost, false);
      } else {
        o.onFinal(refined, cost);
      }
    }
    return cost;
  }

  return { state, start, endSession, stop, cancel, cancelPendingAutoSend };
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
