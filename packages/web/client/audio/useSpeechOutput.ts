import { useCallback, useEffect, useRef, useState } from "react";
import { WEB_SERVER_BASE } from "../useSSE.js";

export interface SpeechQueueItem {
  clipId: string;
  text: string;
  audioUrl: string;
}

export interface UseSpeechOutputOptions {
  /** UI hint from /api/config — does not block SSE clips (server already synthesized). */
  ttsConfigured: boolean;
  /**
   * Pause while uploading/transcribing a dictation clip (not while merely listening).
   * Recording should be blocked separately via `shouldBlockMicCapture` during agent TTS.
   */
  pauseWhenCapture?: boolean;
}

/** After agent TTS ends, ignore mic VAD briefly so speaker bleed does not arm recording. */
const MIC_BLOCK_AFTER_TTS_MS = 1200;

function resolveAudioUrl(audioUrl: string): string {
  if (audioUrl.startsWith("http://") || audioUrl.startsWith("https://")) return audioUrl;
  const base = WEB_SERVER_BASE.replace(/\/$/, "");
  const path = audioUrl.startsWith("/") ? audioUrl : `/${audioUrl}`;
  return base ? `${base}${path}` : path;
}

/** Tiny silent WAV — unlocks autoplay after a user gesture calls play() once. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";

function isBenignPlaybackError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return err.name === "AbortError";
}

export function useSpeechOutput(opts: UseSpeechOutputOptions) {
  const queueRef = useRef<SpeechQueueItem[]>([]);
  const playingRef = useRef(false);
  /** Bumped on intentional stop so in-flight play() AbortErrors are ignored. */
  const playGenRef = useRef(0);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);
  const pauseCaptureRef = useRef(Boolean(opts.pauseWhenCapture));
  const micBlockUntilRef = useRef(0);
  const [lastSpoken, setLastSpoken] = useState<string | null>(null);
  const [queueLength, setQueueLength] = useState(0);
  const [playError, setPlayError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  pauseCaptureRef.current = Boolean(opts.pauseWhenCapture);

  const stopActivePlayback = useCallback(() => {
    playGenRef.current += 1;
    const audio = activeAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      activeAudioRef.current = null;
    }
    playingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const flush = useCallback(() => {
    queueRef.current = [];
    setQueueLength(0);
    stopActivePlayback();
  }, [stopActivePlayback]);

  const interrupt = useCallback(() => {
    flush();
  }, [flush]);

  /** Call from send / mic click so later agent speak() clips can autoplay. */
  const unlockAudio = useCallback(async (): Promise<boolean> => {
    if (unlockedRef.current) return true;
    const audio = new Audio();
    audio.src = SILENT_WAV;
    try {
      await audio.play();
      unlockedRef.current = true;
      setPlayError(null);
      return true;
    } catch (err) {
      if (!isBenignPlaybackError(err)) {
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError") {
          setPlayError("Browser blocked audio — click Send or the mic once, then try again.");
        }
      }
      return false;
    }
  }, []);

  const playNext = useCallback(() => {
    if (pauseCaptureRef.current) {
      playingRef.current = false;
      setIsSpeaking(false);
      return;
    }
    const next = queueRef.current.shift();
    setQueueLength(queueRef.current.length);
    if (!next) {
      playingRef.current = false;
      setIsSpeaking(false);
      if (queueRef.current.length === 0) {
        micBlockUntilRef.current = Date.now() + MIC_BLOCK_AFTER_TTS_MS;
      }
      return;
    }
    playingRef.current = true;
    setIsSpeaking(true);
    const url = resolveAudioUrl(next.audioUrl);
    const gen = playGenRef.current;
    const audio = new Audio();
    activeAudioRef.current = audio;
    audio.src = url;
    setLastSpoken(next.text);

    const onDone = () => {
      if (gen !== playGenRef.current) return;
      audio.removeEventListener("ended", onDone);
      audio.removeEventListener("error", onDone);
      if (activeAudioRef.current === audio) activeAudioRef.current = null;
      playNext();
    };

    audio.addEventListener("ended", onDone);
    audio.addEventListener("error", onDone);

    void audio.play().catch((err: unknown) => {
      if (gen !== playGenRef.current) return;
      if (isBenignPlaybackError(err)) return;
      const name = err instanceof Error ? err.name : "";
      const msg =
        name === "NotAllowedError"
          ? "Browser blocked audio — click Send or the mic once, then try again."
          : `Playback failed (${name || "error"}).`;
      setPlayError(msg);
      playingRef.current = false;
      setIsSpeaking(false);
      if (activeAudioRef.current === audio) activeAudioRef.current = null;
      queueRef.current.unshift(next);
      setQueueLength(queueRef.current.length);
    });
  }, []);

  const enqueue = useCallback(
    (item: SpeechQueueItem) => {
      setPlayError(null);
      queueRef.current.push(item);
      setQueueLength(queueRef.current.length);
      if (pauseCaptureRef.current) return;
      if (!playingRef.current) {
        void unlockAudio().finally(() => playNext());
      }
    },
    [playNext, unlockAudio]
  );

  const shouldBlockMicCapture = useCallback((): boolean => {
    return (
      playingRef.current ||
      queueRef.current.length > 0 ||
      Date.now() < micBlockUntilRef.current
    );
  }, []);

  useEffect(() => {
    if (opts.pauseWhenCapture) {
      stopActivePlayback();
      return;
    }
    if (queueRef.current.length > 0 && !playingRef.current) {
      void unlockAudio().finally(() => playNext());
    }
  }, [opts.pauseWhenCapture, playNext, unlockAudio, stopActivePlayback]);

  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);

  return {
    enqueue,
    interrupt,
    flush,
    unlockAudio,
    shouldBlockMicCapture,
    lastSpoken,
    queueLength,
    playError,
    isSpeaking,
    ttsConfigured: opts.ttsConfigured,
  };
}
