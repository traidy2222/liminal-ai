/**
 * Text-to-speech via OpenAI-compatible `/audio/speech` (OpenRouter, OpenAI, etc.).
 *
 * Mirrors `transcription.ts`: one wire protocol, model slug + cost registry differ.
 * Default model: hexgrad/kokoro-82m (~$0.62/M characters on OpenRouter).
 */
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
import { resolveManagedOpenRouterCredentials } from "./inference_provider.js";

// ─── Model registry ──────────────────────────────────────────────────────────

export interface TtsModelRate {
  /** USD per character. */
  perCharUsd: number;
  label: string;
}

export const TTS_MODEL_RATES: Readonly<Record<string, TtsModelRate>> = {
  "hexgrad/kokoro-82m": {
    perCharUsd: 0.62 / 1_000_000,
    label: "Kokoro 82M",
  },
  "openai/gpt-4o-mini-tts": {
    perCharUsd: 0.62 / 1_000_000,
    label: "GPT-4o Mini TTS",
  },
  "openai/gpt-4o-mini-tts-2025-12-15": {
    perCharUsd: 0.62 / 1_000_000,
    label: "GPT-4o Mini TTS (2025-12-15)",
  },
};

export const DEFAULT_TTS_MODEL = "hexgrad/kokoro-82m";
/** Kokoro preset (hexgrad/kokoro-82m). */
export const DEFAULT_TTS_VOICE = "af_sky";
export const DEFAULT_KOKORO_TTS_VOICE = DEFAULT_TTS_VOICE;
/** OpenAI / OpenRouter GPT-4o TTS voices (openai/gpt-4o-mini-tts*). */
export const DEFAULT_OPENAI_TTS_VOICE = "nova";

/** OpenAI-style voices — invalid for Kokoro; map to a Kokoro preset instead. */
const OPENAI_STYLE_TTS_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
]);

const KOKORO_VOICE_IDS = new Set([
  "af",
  "af_bella",
  "af_sarah",
  "af_nicole",
  "af_sky",
  "am_adam",
  "am_michael",
  "bf_emma",
  "bf_isabella",
  "bm_george",
  "bm_lewis",
]);

function isKokoroModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes("kokoro") || m.startsWith("hexgrad/");
}

function isOpenAiTtsModel(model: string): boolean {
  if (isKokoroModel(model)) return false;
  const m = model.toLowerCase();
  return (
    (m.startsWith("openai/") && m.includes("tts")) ||
    (m.includes("gpt-4o") && m.includes("tts"))
  );
}

export function defaultTtsVoiceForModel(model: string): string {
  return isKokoroModel(model) ? DEFAULT_KOKORO_TTS_VOICE : DEFAULT_OPENAI_TTS_VOICE;
}

/** OpenRouter `/audio/speech` only accepts mp3 or pcm (not wav/opus/flac). */
export function wireTtsResponseFormat(
  baseURL: string,
  format: SpeechSynthesisConfig["responseFormat"]
): "mp3" | "pcm" {
  if (baseURL.includes("openrouter.ai")) {
    return format === "pcm" ? "pcm" : "mp3";
  }
  return format === "pcm" ? "pcm" : "mp3";
}

/**
 * Pick a voice id valid for the configured TTS model (Kokoro vs OpenAI slugs differ).
 */
export function coerceTtsVoiceForModel(model: string, voice: string): string {
  const lower = voice.trim().toLowerCase();
  if (isKokoroModel(model)) {
    if (!lower) return DEFAULT_KOKORO_TTS_VOICE;
    if (OPENAI_STYLE_TTS_VOICES.has(lower)) return DEFAULT_KOKORO_TTS_VOICE;
    if (KOKORO_VOICE_IDS.has(lower)) return lower;
    return DEFAULT_KOKORO_TTS_VOICE;
  }
  if (isOpenAiTtsModel(model)) {
    if (!lower) return DEFAULT_OPENAI_TTS_VOICE;
    if (OPENAI_STYLE_TTS_VOICES.has(lower)) return lower;
    if (KOKORO_VOICE_IDS.has(lower)) return DEFAULT_OPENAI_TTS_VOICE;
    return DEFAULT_OPENAI_TTS_VOICE;
  }
  return lower || defaultTtsVoiceForModel(model);
}

export function estimateTtsCostUsd(model: string, charCount: number): number {
  const rate = TTS_MODEL_RATES[model];
  if (!rate || !Number.isFinite(charCount) || charCount <= 0) return 0;
  return charCount * rate.perCharUsd;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface SpeechSynthesisConfig {
  enabled: boolean;
  model: string;
  voice: string;
  baseURL: string;
  apiKey: string;
  timeoutMs: number;
  maxCharsPerCall: number;
  maxCallsPerTurn: number;
  minIntervalMs: number;
  responseFormat: "mp3" | "pcm" | "wav" | "opus" | "flac";
  /** Audio output token budget sent as `max_tokens` on /audio/speech (OpenRouter). */
  maxOutputTokens: number;
  /** Max characters per upstream TTS request (longer lines are split into segments). */
  chunkChars: number;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 45_000;
/** OpenRouter TTS models (Kokoro, GPT-4o mini TTS) advertise ~4K input context. */
export const TTS_MODEL_INPUT_MAX_CHARS = 4096;
/**
 * OpenRouter `/audio/speech` uses `max_tokens` for **audio output** tokens (not input chars).
 * When omitted, the platform can default to a tiny cap (~45) and clip speech mid-utterance.
 */
export const TTS_MODEL_OUTPUT_MAX_TOKENS = 4096;
/** OpenRouter recommends splitting long lines; per-request caps vary by provider/model. */
export const DEFAULT_TTS_CHUNK_CHARS = 400;
const DEFAULT_MAX_CHARS = TTS_MODEL_INPUT_MAX_CHARS;
const DEFAULT_MAX_CALLS = 8;
const DEFAULT_MIN_INTERVAL_MS = 800;
const MIN_TTS_CHUNK_CHARS = 120;
const MAX_TTS_CHUNK_CHARS = 800;

function resolveMaxCharsPerCall(prefs: RuntimePreferences | null): number {
  const raw = resolveHarnessEnvRaw("AGENT_TTS_MAX_CHARS_PER_CALL", prefs)?.trim() ?? "";
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return TTS_MODEL_INPUT_MAX_CHARS;
  }
  return Math.min(parsed, TTS_MODEL_INPUT_MAX_CHARS);
}

function resolveMaxOutputTokens(prefs: RuntimePreferences | null): number {
  const raw = resolveHarnessEnvRaw("AGENT_TTS_MAX_OUTPUT_TOKENS", prefs)?.trim() ?? "";
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return TTS_MODEL_OUTPUT_MAX_TOKENS;
  }
  return Math.min(parsed, 16_384);
}

function resolveChunkChars(prefs: RuntimePreferences | null): number {
  const raw = resolveHarnessEnvRaw("AGENT_TTS_CHUNK_CHARS", prefs)?.trim() ?? "";
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TTS_CHUNK_CHARS;
  }
  return Math.min(MAX_TTS_CHUNK_CHARS, Math.max(MIN_TTS_CHUNK_CHARS, parsed));
}

/** Scale output token budget to input size so short lines are not over-billed but long lines are not clipped. */
export function ttsMaxOutputTokensForInput(inputChars: number, cap: number): number {
  const safeCap = Math.max(256, cap);
  if (inputChars <= 0) return Math.min(safeCap, 512);
  const scaled = Math.ceil(inputChars * 2) + 256;
  return Math.min(safeCap, Math.max(512, scaled));
}

/**
 * Split sanitized text into segments for reliable TTS (OpenRouter best practice).
 * Breaks on sentence boundaries when possible, else word boundaries.
 */
export function splitTextForTtsChunks(text: string, maxChunkChars: number): string[] {
  const max = Math.max(MIN_TTS_CHUNK_CHARS, maxChunkChars);
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= max) return [trimmed];

  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let breakAt = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("? "),
      window.lastIndexOf("! "),
      window.lastIndexOf(".\n"),
      window.lastIndexOf("?\n"),
      window.lastIndexOf("!\n"),
      window.lastIndexOf("\n")
    );
    if (breakAt >= max * 0.45) {
      breakAt += 1;
    } else {
      breakAt = window.lastIndexOf(" ");
      if (breakAt < max * 0.35) breakAt = max;
    }
    const piece = rest.slice(0, breakAt).trim();
    if (!piece) break;
    chunks.push(piece);
    rest = rest.slice(breakAt).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.length > 0 ? chunks : [trimmed];
}

export function resolveSpeechSynthesisConfig(
  prefs: RuntimePreferences | null
): SpeechSynthesisConfig {
  const enabled = resolveHarnessEnvRaw("AGENT_TTS_ENABLED", prefs) === "1";
  const model =
    resolveHarnessEnvRaw("AGENT_TTS_MODEL", prefs)?.trim() || DEFAULT_TTS_MODEL;
  const voiceRaw = resolveHarnessEnvRaw("AGENT_TTS_VOICE", prefs)?.trim() ?? "";
  const voice = coerceTtsVoiceForModel(model, voiceRaw || defaultTtsVoiceForModel(model));
  const baseURL =
    resolveHarnessEnvRaw("AGENT_TTS_BASE_URL", prefs)?.trim() ||
    resolveHarnessEnvRaw("AGENT_API_BASE_URL", prefs)?.trim() ||
    DEFAULT_BASE_URL;
  const apiKey =
    (process.env["AGENT_TTS_API_KEY"]?.trim() ||
      process.env["AGENT_API_KEY"]?.trim() ||
      process.env["OPENROUTER_API_KEY"]?.trim()) ??
    "";
  const timeoutRaw = resolveHarnessEnvRaw("AGENT_TTS_TIMEOUT_MS", prefs)?.trim() ?? "";
  const timeoutParsed = parseInt(timeoutRaw, 10);
  const timeoutMs =
    Number.isFinite(timeoutParsed) && timeoutParsed > 0 ? timeoutParsed : DEFAULT_TIMEOUT_MS;
  const maxCharsPerCall = resolveMaxCharsPerCall(prefs);
  const maxOutputTokens = resolveMaxOutputTokens(prefs);
  const chunkChars = resolveChunkChars(prefs);
  const maxCallsRaw =
    resolveHarnessEnvRaw("AGENT_TTS_MAX_CALLS_PER_TURN", prefs)?.trim() ?? "";
  const maxCallsParsed = parseInt(maxCallsRaw, 10);
  const maxCallsPerTurn =
    Number.isFinite(maxCallsParsed) && maxCallsParsed > 0 ? maxCallsParsed : DEFAULT_MAX_CALLS;
  const minIntervalRaw =
    resolveHarnessEnvRaw("AGENT_TTS_MIN_INTERVAL_MS", prefs)?.trim() ?? "";
  const minIntervalParsed = parseInt(minIntervalRaw, 10);
  const minIntervalMs =
    Number.isFinite(minIntervalParsed) && minIntervalParsed >= 0
      ? minIntervalParsed
      : DEFAULT_MIN_INTERVAL_MS;
  const formatRaw =
    resolveHarnessEnvRaw("AGENT_TTS_RESPONSE_FORMAT", prefs)?.trim().toLowerCase() ?? "mp3";
  const responseFormat: SpeechSynthesisConfig["responseFormat"] =
    formatRaw === "mp3" ||
    formatRaw === "pcm" ||
    formatRaw === "wav" ||
    formatRaw === "opus" ||
    formatRaw === "flac"
      ? formatRaw
      : "mp3";
  return {
    enabled,
    model,
    voice,
    baseURL,
    apiKey,
    timeoutMs,
    maxCharsPerCall,
    maxCallsPerTurn,
    minIntervalMs,
    responseFormat,
    maxOutputTokens,
    chunkChars,
  };
}

/** TTS config with managed-inference routing when entitled (unless AGENT_TTS_API_KEY is set). */
export async function resolveSpeechSynthesisConfigAsync(
  prefs: RuntimePreferences | null
): Promise<SpeechSynthesisConfig> {
  const base = resolveSpeechSynthesisConfig(prefs);
  if (process.env["AGENT_TTS_API_KEY"]?.trim()) {
    return base;
  }
  const creds = await resolveManagedOpenRouterCredentials(prefs);
  if (creds.route === "managed") {
    return { ...base, apiKey: creds.apiKey, baseURL: creds.baseURL };
  }
  return base;
}

// ─── Text sanitization ───────────────────────────────────────────────────────

/** Strip markdown/code so TTS does not read fences or huge blocks aloud. */
export function sanitizeTextForTts(raw: string, maxChars: number): string {
  let text = String(raw ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(" ");
    text = (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
  }
  return text;
}

// ─── Synthesis call ──────────────────────────────────────────────────────────

export interface SynthesizeSpeechInput {
  text: string;
  voice?: string;
  model?: string;
  format?: SpeechSynthesisConfig["responseFormat"];
  signal?: AbortSignal;
}

export interface SynthesizeSpeechResult {
  audio: Uint8Array;
  mimeType: string;
  /** Characters in this segment (or full line when unsplit). */
  charCount: number;
  /** Sanitized text synthesized in this segment. */
  spokenText: string;
  maxOutputTokens: number;
  costUsd: number;
  model: string;
  voice: string;
  provider: string;
}

export interface SynthesizeSpeechMultiResult {
  segments: SynthesizeSpeechResult[];
  charCount: number;
  costUsd: number;
}

export async function synthesizeSpeechMulti(
  input: SynthesizeSpeechInput,
  config: SpeechSynthesisConfig
): Promise<SynthesizeSpeechMultiResult> {
  if (!config.enabled) {
    throw new Error("Text-to-speech is disabled (AGENT_TTS_ENABLED=0).");
  }
  if (!config.apiKey) {
    throw new Error(
      "No TTS API key. Set AGENT_TTS_API_KEY, AGENT_API_KEY, or OPENROUTER_API_KEY."
    );
  }
  const sanitized = sanitizeTextForTts(input.text, config.maxCharsPerCall);
  if (!sanitized) {
    throw new Error("TTS text is empty after sanitization.");
  }
  const chunks = splitTextForTtsChunks(sanitized, config.chunkChars);
  const segments: SynthesizeSpeechResult[] = [];
  for (const chunk of chunks) {
    segments.push(
      await synthesizeSpeechSegment(
        { ...input, text: chunk },
        config,
        chunk
      )
    );
  }
  return {
    segments,
    charCount: sanitized.length,
    costUsd: segments.reduce((sum, s) => sum + s.costUsd, 0),
  };
}

export async function synthesizeSpeech(
  input: SynthesizeSpeechInput,
  config: SpeechSynthesisConfig
): Promise<SynthesizeSpeechResult> {
  const multi = await synthesizeSpeechMulti(input, config);
  if (multi.segments.length === 1) return multi.segments[0]!;
  throw new Error(
    `TTS input spans ${multi.segments.length} segments — use synthesizeSpeechMulti() for playback.`
  );
}

async function synthesizeSpeechSegment(
  input: SynthesizeSpeechInput,
  config: SpeechSynthesisConfig,
  sanitized: string
): Promise<SynthesizeSpeechResult> {
  const model = (input.model ?? config.model).trim() || DEFAULT_TTS_MODEL;
  const voice = coerceTtsVoiceForModel(
    model,
    (input.voice ?? config.voice).trim() || DEFAULT_TTS_VOICE
  );
  const storedFormat = input.format ?? config.responseFormat;
  const wireFormat = wireTtsResponseFormat(config.baseURL, storedFormat);
  const maxOutputTokens = ttsMaxOutputTokensForInput(sanitized.length, config.maxOutputTokens);

  const url = `${config.baseURL.replace(/\/$/, "")}/audio/speech`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
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
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: sanitized,
        voice,
        response_format: wireFormat,
        max_tokens: maxOutputTokens,
      }),
      signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    let detail = errText.slice(0, 400) || resp.statusText;
    try {
      const parsed = JSON.parse(errText) as {
        error?: { message?: string; metadata?: { raw?: string } };
      };
      const msg = parsed.error?.message;
      const raw = parsed.error?.metadata?.raw;
      if (msg) detail = raw ? `${msg} — ${String(raw).slice(0, 200)}` : msg;
    } catch {
      /* keep raw slice */
    }
    throw new Error(
      `TTS HTTP ${resp.status}: ${detail} (model=${model}, voice=${voice}, format=${wireFormat})`
    );
  }

  const buf = new Uint8Array(await resp.arrayBuffer());
  const mimeType = mimeForWireFormat(wireFormat);
  return {
    audio: buf,
    mimeType,
    charCount: sanitized.length,
    spokenText: sanitized,
    maxOutputTokens,
    costUsd: estimateTtsCostUsd(model, sanitized.length),
    model,
    voice,
    provider: providerFromBaseUrl(config.baseURL),
  };
}

function mimeForWireFormat(format: "mp3" | "pcm"): string {
  return format === "pcm" ? "audio/pcm" : "audio/mpeg";
}

/** OpenAI-compatible PCM from `/audio/speech` (24 kHz, mono, 16-bit LE). */
export const TTS_PCM_SAMPLE_RATE = 24_000;

/**
 * HTML `<audio>` cannot play raw `audio/pcm`. Web TTS should synthesize mp3, but
 * coerce config when callers still request pcm/wav/opus/flac.
 */
export function coerceTtsConfigForBrowserPlayback(
  config: SpeechSynthesisConfig
): SpeechSynthesisConfig {
  if (config.responseFormat === "mp3") return config;
  return { ...config, responseFormat: "mp3" };
}

/** Wrap raw PCM16 LE mono in a WAV container for browser playback. */
export function wrapPcm16LeMonoAsWav(
  pcm: Uint8Array,
  sampleRate = TTS_PCM_SAMPLE_RATE
): Uint8Array {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);
  out.set(pcm, 44);
  return out;
}

/** Normalize stored/served TTS bytes so `<audio>` and MediaSource can decode them. */
export function normalizeTtsBytesForBrowserPlayback(
  audio: Uint8Array,
  mimeType: string
): { bytes: Uint8Array; mimeType: string } {
  const m = mimeType.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) {
    return { bytes: audio, mimeType: "audio/mpeg" };
  }
  if (m.includes("wav")) {
    return { bytes: audio, mimeType: "audio/wav" };
  }
  if (m.includes("opus")) {
    return { bytes: audio, mimeType: "audio/opus" };
  }
  if (m.includes("flac")) {
    return { bytes: audio, mimeType: "audio/flac" };
  }
  if (m.includes("pcm") || m === "application/octet-stream") {
    return {
      bytes: wrapPcm16LeMonoAsWav(audio),
      mimeType: "audio/wav",
    };
  }
  return { bytes: audio, mimeType: mimeType || "audio/mpeg" };
}

function providerFromBaseUrl(baseURL: string): string {
  try {
    return new URL(baseURL).hostname;
  } catch {
    return "unknown";
  }
}

function chainSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  if (a.aborted || b.aborted) {
    const c = new AbortController();
    c.abort();
    return c.signal;
  }
  const merged = new AbortController();
  const onAbort = () => merged.abort();
  a.addEventListener("abort", onAbort);
  b.addEventListener("abort", onAbort);
  return merged.signal;
}
