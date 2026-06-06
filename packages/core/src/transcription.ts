/**
 * Audio transcription provider abstraction.
 *
 * Two wire formats for `/audio/transcriptions`:
 * - **OpenRouter** (`openrouter.ai`): JSON + base64 `input_audio` (Parakeet, Whisper, …).
 * - **Direct OpenAI** (`api.openai.com`): multipart upload + `verbose_json`.
 *
 * Model registry — defaults to `nvidia/parakeet-tdt-0.6b-v3` at $0.0015/minute
 * (English + EU languages). Falls back to `openai/whisper-large-v3-turbo` for
 * broad 99-language coverage. Per-model rates live next to the registry so cost
 * can be computed locally from the duration the API returns, without a second call.
 */
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
import { resolveManagedOpenRouterCredentials } from "./inference_provider.js";

// ─── Model registry ──────────────────────────────────────────────────────────

/**
 * Rate is normalized to USD per second so the cost calculator can multiply
 * durationSec directly. Source: provider price pages as of 2026-05.
 */
export interface TranscriptionModelRate {
  /** Per-second USD rate. */
  perSecondUsd: number;
  /** Human label for telemetry/UI. */
  label: string;
  /** Notes on language/accuracy trade-offs. */
  notes?: string;
}

export const TRANSCRIPTION_MODEL_RATES: Readonly<Record<string, TranscriptionModelRate>> = {
  // Tier 1 — default. NVIDIA Parakeet: cheapest accurate option, English + EU.
  "nvidia/parakeet-tdt-0.6b-v3": {
    perSecondUsd: 0.0015 / 60,
    label: "NVIDIA Parakeet TDT 0.6B v3",
    notes:
      "Default. English + all official EU languages with auto language detection, " +
      "6.34% avg WER (HF Open ASR Leaderboard). Per-minute pricing; punctuation + segment timestamps. " +
      "For non-EU languages (Mandarin, Hindi, Arabic, …) use whisper-large-v3-turbo instead.",
  },
  // Broad multilingual fallback — 99 languages when you need coverage Parakeet lacks.
  "openai/whisper-large-v3-turbo": {
    perSecondUsd: 0.04 / 3600,
    label: "Whisper Large V3 Turbo",
    notes: "99 languages, 12% WER, real-time speed factor up to 216×.",
  },
  // Tier 2 — accuracy upgrade when WER matters more than cost (10.3% vs 12%).
  "openai/whisper-large-v3": {
    perSecondUsd: 0.111 / 3600,
    label: "Whisper Large V3",
    notes: "Higher accuracy and word-level timestamps. ~3× the cost of Turbo.",
  },
  // Tier 3 — Chinese dialects, lyrics-over-music, vocabulary biasing.
  "qwen/qwen3-asr-flash": {
    perSecondUsd: 0.000035,
    label: "Qwen3 ASR Flash",
    notes:
      "11 languages incl. Cantonese/Sichuanese/Wu/Minnan. Auto language detection, " +
      "noise-robust, accepts arbitrary context text to bias recognition.",
  },
  // Tier 4 — alternative European-language ASR.
  "mistralai/voxtral-mini-transcribe": {
    perSecondUsd: 0.003 / 60,
    label: "Mistral Voxtral Mini Transcribe",
    notes: "Mistral's Voxtral family. Per-minute pricing; competitive on French/Italian/Spanish.",
  },
  // Legacy — still cheaper than most chat models but 9× Turbo's price.
  "openai/whisper-1": {
    perSecondUsd: 0.006 / 60,
    label: "Whisper 1 (legacy)",
    notes: "Older API model. Use Whisper Large V3 Turbo unless you need this exact slug.",
  },
};

/** Default model when `AGENT_TRANSCRIBE_MODEL` is unset. */
export const DEFAULT_TRANSCRIBE_MODEL = "nvidia/parakeet-tdt-0.6b-v3";

/**
 * Estimate USD cost for a transcription run. Returns 0 when the model isn't in
 * the registry — better to undercount than to fabricate a rate.
 */
export function estimateTranscriptionCostUsd(model: string, durationSec: number): number {
  const rate = TRANSCRIPTION_MODEL_RATES[model];
  if (!rate || !Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return durationSec * rate.perSecondUsd;
}

// ─── Config resolution ───────────────────────────────────────────────────────

/** All defaults match the cheapest viable production setup out of the box. */
export interface TranscriptionConfig {
  enabled: boolean;
  model: string;
  baseURL: string;
  apiKey: string;
  maxBytes: number;
  timeoutMs: number;
  autoOnUpload: boolean;
  timestamps: "none" | "segment" | "word";
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_BYTES = 26_214_400; // 25 MB (matches Whisper-1 historical cap)
const DEFAULT_TIMEOUT_MS = 120_000;

export function resolveTranscriptionConfig(
  prefs: RuntimePreferences | null
): TranscriptionConfig {
  const enabled = resolveHarnessEnvRaw("AGENT_TRANSCRIBE_ENABLED", prefs) !== "0";
  const model =
    resolveHarnessEnvRaw("AGENT_TRANSCRIBE_MODEL", prefs)?.trim() || DEFAULT_TRANSCRIBE_MODEL;
  const baseURL =
    resolveHarnessEnvRaw("AGENT_TRANSCRIBE_BASE_URL", prefs)?.trim() ||
    resolveHarnessEnvRaw("AGENT_API_BASE_URL", prefs)?.trim() ||
    DEFAULT_BASE_URL;
  // API key precedence: transcribe-specific override → primary AGENT_API_KEY →
  // raw OPENROUTER_API_KEY env. Never persisted to runtime prefs.
  const apiKey =
    (process.env["AGENT_TRANSCRIBE_API_KEY"]?.trim() ||
      process.env["AGENT_API_KEY"]?.trim() ||
      process.env["OPENROUTER_API_KEY"]?.trim()) ??
    "";
  const maxBytesRaw =
    resolveHarnessEnvRaw("AGENT_TRANSCRIBE_MAX_BYTES", prefs)?.trim() ?? "";
  const maxBytesParsed = parseInt(maxBytesRaw, 10);
  const maxBytes =
    Number.isFinite(maxBytesParsed) && maxBytesParsed > 0 ? maxBytesParsed : DEFAULT_MAX_BYTES;
  const timeoutRaw =
    resolveHarnessEnvRaw("AGENT_TRANSCRIBE_TIMEOUT_MS", prefs)?.trim() ?? "";
  const timeoutParsed = parseInt(timeoutRaw, 10);
  const timeoutMs =
    Number.isFinite(timeoutParsed) && timeoutParsed > 0 ? timeoutParsed : DEFAULT_TIMEOUT_MS;
  const autoOnUpload =
    resolveHarnessEnvRaw("AGENT_TRANSCRIBE_AUTO_ON_UPLOAD", prefs) !== "0";
  const timestampsRaw =
    resolveHarnessEnvRaw("AGENT_TRANSCRIBE_TIMESTAMPS", prefs)?.trim().toLowerCase() ?? "segment";
  const timestamps: TranscriptionConfig["timestamps"] =
    timestampsRaw === "none" || timestampsRaw === "word" ? timestampsRaw : "segment";
  return { enabled, model, baseURL, apiKey, maxBytes, timeoutMs, autoOnUpload, timestamps };
}

/** Transcription config with managed-inference routing when entitled (unless AGENT_TRANSCRIBE_API_KEY is set). */
export async function resolveTranscriptionConfigAsync(
  prefs: RuntimePreferences | null
): Promise<TranscriptionConfig> {
  const base = resolveTranscriptionConfig(prefs);
  if (process.env["AGENT_TRANSCRIBE_API_KEY"]?.trim()) {
    return base;
  }
  const creds = await resolveManagedOpenRouterCredentials(prefs);
  if (creds.route === "managed") {
    return { ...base, apiKey: creds.apiKey, baseURL: creds.baseURL };
  }
  return base;
}

// ─── Transcription call ──────────────────────────────────────────────────────

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationSec?: number;
  segments?: TranscriptionSegment[];
  /** Estimated USD cost from durationSec × per-model rate. */
  costUsd: number;
  model: string;
  /** Provider host extracted from baseURL — for telemetry. */
  provider: string;
}

export interface TranscriptionInput {
  /** Raw audio bytes. */
  audio: Buffer | Uint8Array;
  /** Filename including extension — used for content-type detection by the API. */
  filename: string;
  /** Override the configured model. */
  model?: string;
  /** Optional ISO-639 language hint (skip for auto-detect). */
  language?: string;
  /** Optional vocabulary biasing — short text of names/jargon to expect. */
  prompt?: string;
  /** Timestamp granularity. */
  timestamps?: "none" | "segment" | "word";
  signal?: AbortSignal;
}

/** OpenRouter STT rejects multipart; it requires JSON + base64 `input_audio`. */
export function usesOpenRouterSttJson(baseURL: string): boolean {
  try {
    const host = new URL(baseURL).hostname.toLowerCase();
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return /openrouter\.ai/i.test(baseURL);
  }
}

/**
 * Call `/audio/transcriptions` on the configured provider. OpenRouter uses JSON;
 * direct OpenAI uses multipart + `verbose_json`. Returns parsed transcript + cost.
 */
export async function transcribeAudio(
  input: TranscriptionInput,
  config: TranscriptionConfig
): Promise<TranscriptionResult> {
  if (!config.enabled) {
    throw new Error("Transcription is disabled (AGENT_TRANSCRIBE_ENABLED=0).");
  }
  if (!config.apiKey) {
    throw new Error(
      "No transcription API key. Set AGENT_TRANSCRIBE_API_KEY, AGENT_API_KEY, or OPENROUTER_API_KEY."
    );
  }
  if (input.audio.byteLength > config.maxBytes) {
    throw new Error(
      `Audio file exceeds AGENT_TRANSCRIBE_MAX_BYTES (${config.maxBytes} bytes). Split it first.`
    );
  }
  const model = (input.model ?? config.model).trim() || DEFAULT_TRANSCRIBE_MODEL;
  const timestamps = input.timestamps ?? config.timestamps;

  const url = `${config.baseURL.replace(/\/$/, "")}/audio/transcriptions`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (config.baseURL.includes("openrouter")) {
    headers["HTTP-Referer"] = "https://github.com/yourorg/liminal";
    headers["X-Title"] = "Liminal Harness";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const signal = chainSignals(controller.signal, input.signal);

  let resp: Response;
  try {
    if (usesOpenRouterSttJson(config.baseURL)) {
      const body: Record<string, unknown> = {
        model,
        input_audio: {
          data: Buffer.from(input.audio).toString("base64"),
          format: inferAudioFormat(input.filename),
        },
      };
      if (input.language) body.language = input.language;
      headers["Content-Type"] = "application/json";
      resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } else {
      const form = new FormData();
      const blob = new Blob([toArrayBuffer(input.audio)], {
        type: inferContentType(input.filename),
      });
      form.append("file", blob, input.filename);
      form.append("model", model);
      form.append("response_format", "verbose_json");
      if (input.language) form.append("language", input.language);
      if (input.prompt) form.append("prompt", input.prompt);
      if (timestamps === "word") {
        form.append("timestamp_granularities[]", "word");
      } else if (timestamps === "segment") {
        form.append("timestamp_granularities[]", "segment");
      }
      resp = await fetch(url, { method: "POST", headers, body: form, signal });
    }
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(
      `Transcription HTTP ${resp.status}: ${errText.slice(0, 400) || resp.statusText}`
    );
  }
  const json = (await resp.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ start: number; end: number; text: string }>;
    usage?: { seconds?: number };
  };
  const text = String(json.text ?? "").trim();
  const language = typeof json.language === "string" ? json.language : undefined;
  const durationSec =
    typeof json.duration === "number" && Number.isFinite(json.duration)
      ? json.duration
      : typeof json.usage?.seconds === "number" && Number.isFinite(json.usage.seconds)
        ? json.usage.seconds
        : undefined;
  const segments = Array.isArray(json.segments)
    ? json.segments
        .filter((s) => typeof s.text === "string")
        .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: String(s.text) }))
    : undefined;
  const costUsd = durationSec ? estimateTranscriptionCostUsd(model, durationSec) : 0;
  return {
    text,
    language,
    durationSec,
    segments,
    costUsd,
    model,
    provider: providerFromBaseUrl(config.baseURL),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a Buffer/Uint8Array to a tight ArrayBuffer slice. We can't pass the
 * Uint8Array directly into `new Blob([])` under strict TS because some Node
 * variants type the underlying buffer as SharedArrayBuffer | ArrayBuffer.
 * Copying into a fresh ArrayBuffer is the cheapest universally-safe path.
 */
function toArrayBuffer(buf: Buffer | Uint8Array): ArrayBuffer {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

function inferContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".aac")) return "audio/aac";
  return "application/octet-stream";
}

/** OpenRouter `input_audio.format` — extension without dot. */
function inferAudioFormat(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".wav")) return "wav";
  if (lower.endsWith(".mp3")) return "mp3";
  if (lower.endsWith(".flac")) return "flac";
  if (lower.endsWith(".m4a")) return "m4a";
  if (lower.endsWith(".mp4")) return "m4a";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "ogg";
  if (lower.endsWith(".webm")) return "webm";
  if (lower.endsWith(".aac")) return "aac";
  return "wav";
}

function providerFromBaseUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function chainSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const sigs = signals.filter((s): s is AbortSignal => s != null);
  if (sigs.length === 0) return new AbortController().signal;
  if (sigs.length === 1) return sigs[0]!;
  const c = new AbortController();
  for (const s of sigs) {
    if (s.aborted) {
      c.abort();
      break;
    }
    s.addEventListener("abort", () => c.abort(), { once: true });
  }
  return c.signal;
}
