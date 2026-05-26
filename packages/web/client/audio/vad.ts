/**
 * Voice Activity Detection (VAD) — RMS-based, adaptive noise floor.
 *
 * Hooks a Web Audio AnalyserNode to a live MediaStream and samples short-time
 * loudness (root-mean-square of the time-domain waveform) every ~50 ms. The
 * first `calibrationMs` of audio establish the ambient noise floor; speech is
 * declared when RMS exceeds the floor by `speechThresholdGain`.
 *
 * Purely a detection primitive — emits start/end events and continuous
 * silence-duration ticks; the higher-level dictation state machine decides
 * what to do with them (countdown, auto-send, etc.).
 *
 * Why RMS instead of Web Speech timing?
 *   - Works in every browser (Firefox has no Web Speech, but everyone has Web Audio)
 *   - Independent of recognition lag — VAD reacts in 50ms vs Web Speech finals
 *     that can lag 500ms+ behind the actual end of speech
 *   - Gives us the silence-duration counter the countdown UI needs
 */

export interface VadOptions {
  stream: MediaStream;
  /**
   * RMS gain above the calibrated noise floor that counts as speech. Range
   * 0..1; defaults to 0.015 (works well for typical headset / built-in mic
   * audio). Lower = more sensitive (false positives on background noise);
   * higher = requires louder speech.
   */
  speechThresholdGain?: number;
  /** Sample interval in ms. 50ms = 20 frames/sec, enough for endpoint detection. */
  sampleIntervalMs?: number;
  /** First N ms of audio used to calibrate the noise floor. Default 600ms. */
  calibrationMs?: number;
  /**
   * Number of consecutive frames below threshold required to declare
   * "silence" (debounce against single-frame dips during sustained vowels).
   * Default 3 frames @ 50ms = 150ms.
   */
  silenceDebounceFrames?: number;
  /**
   * Number of consecutive frames above threshold required to declare
   * "speech start" (debounce against single-frame spikes from coughs/clicks).
   * Default 2 frames @ 50ms = 100ms.
   */
  speechDebounceFrames?: number;

  /** Fired the first time speech is detected after silence. */
  onSpeechStart?: () => void;
  /**
   * Fired on every sample while silence persists. `msSinceSpeechEnded` lets
   * the consumer drive a live countdown without keeping its own timer.
   */
  onSilenceTick?: (msSinceSpeechEnded: number) => void;
  /** Fired once when speech-to-silence transition is confirmed. */
  onSpeechEnd?: () => void;
  /** Fired when calibration completes. Useful for debugging mic levels. */
  onCalibrated?: (noiseFloor: number) => void;
  /** Fired if the AudioContext / stream errors out. */
  onError?: (err: Error) => void;
}

export interface VadHandle {
  /** Stop sampling, disconnect nodes, close AudioContext. Idempotent. */
  stop: () => void;
  /** Current calibrated noise floor (or 0 if still calibrating). */
  getNoiseFloor: () => number;
  /** True when the analyzer has decided we're currently speaking. */
  isSpeaking: () => boolean;
}

const DEFAULT_THRESHOLD_GAIN = 0.015;
const DEFAULT_SAMPLE_MS = 50;
const DEFAULT_CALIBRATION_MS = 600;
const DEFAULT_SILENCE_DEBOUNCE = 3;
const DEFAULT_SPEECH_DEBOUNCE = 2;

/**
 * Spin up a VAD attached to the given MediaStream. Returns a handle for stop +
 * introspection. The AudioContext is created internally and closed by stop().
 */
export function createVad(opts: VadOptions): VadHandle {
  const thresholdGain = clamp01(opts.speechThresholdGain ?? DEFAULT_THRESHOLD_GAIN);
  const sampleMs = Math.max(20, opts.sampleIntervalMs ?? DEFAULT_SAMPLE_MS);
  const calibrationMs = Math.max(100, opts.calibrationMs ?? DEFAULT_CALIBRATION_MS);
  const silenceDebounce = Math.max(1, opts.silenceDebounceFrames ?? DEFAULT_SILENCE_DEBOUNCE);
  const speechDebounce = Math.max(1, opts.speechDebounceFrames ?? DEFAULT_SPEECH_DEBOUNCE);

  let stopped = false;
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let bufferF32: Float32Array | null = null;
  let timer: number | null = null;

  let noiseFloor = 0;
  let calibrationFrames: number[] = [];
  let calibrating = true;
  const startedAt = performance.now();

  let speaking = false;
  let aboveCount = 0;
  let belowCount = 0;
  let speechEndedAt: number | null = null;

  function cleanup(): void {
    if (stopped) return;
    stopped = true;
    if (timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
    try {
      analyser?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      // Close async; ignore promise.
      void ctx?.close();
    } catch {
      /* ignore */
    }
    ctx = null;
    analyser = null;
    source = null;
    bufferF32 = null;
  }

  try {
    // Some browsers gate AudioContext until a user gesture has occurred. The
    // mic permission grant counts as such, so this is safe at the dictation
    // start path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) throw new Error("AudioContext not supported in this browser.");
    ctx = new AC();
    source = ctx.createMediaStreamSource(opts.stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    bufferF32 = new Float32Array(analyser.fftSize);

    timer = window.setInterval(() => {
      if (!analyser || !bufferF32 || stopped) return;
      try {
        // Cast required because TS lib.dom now generics Float32Array on
        // ArrayBufferLike (could be SharedArrayBuffer in some environments),
        // but Web Audio analyser only ever fills a regular ArrayBuffer-backed
        // view. Runtime is fine; the cast just appeases the strict type.
        analyser.getFloatTimeDomainData(bufferF32 as unknown as Float32Array<ArrayBuffer>);
      } catch (err) {
        opts.onError?.(err instanceof Error ? err : new Error(String(err)));
        cleanup();
        return;
      }
      const rms = computeRms(bufferF32);

      // ── Calibration phase ──────────────────────────────────────────────
      if (calibrating) {
        calibrationFrames.push(rms);
        if (performance.now() - startedAt >= calibrationMs) {
          // Noise floor = 90th percentile of calibration samples so a stray
          // breath doesn't blow the threshold up.
          const sorted = [...calibrationFrames].sort((a, b) => a - b);
          const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));
          noiseFloor = sorted[idx] ?? 0;
          calibrationFrames = [];
          calibrating = false;
          opts.onCalibrated?.(noiseFloor);
        }
        return;
      }

      // ── Frame classification ──────────────────────────────────────────
      const isSpeechFrame = rms > noiseFloor + thresholdGain;
      if (isSpeechFrame) {
        aboveCount += 1;
        belowCount = 0;
        if (!speaking && aboveCount >= speechDebounce) {
          speaking = true;
          speechEndedAt = null;
          opts.onSpeechStart?.();
        }
      } else {
        belowCount += 1;
        aboveCount = 0;
        if (speaking && belowCount >= silenceDebounce) {
          speaking = false;
          speechEndedAt = performance.now();
          opts.onSpeechEnd?.();
        }
        if (!speaking && speechEndedAt != null) {
          opts.onSilenceTick?.(performance.now() - speechEndedAt);
        }
      }
    }, sampleMs);
  } catch (err) {
    opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    cleanup();
  }

  return {
    stop: cleanup,
    getNoiseFloor: () => noiseFloor,
    isSpeaking: () => speaking,
  };
}

function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_THRESHOLD_GAIN;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
