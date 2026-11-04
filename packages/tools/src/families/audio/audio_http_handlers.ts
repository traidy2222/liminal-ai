/**
 * Shared audio upload / transcribe / TTS handlers for web Express and sidecar HTTP.
 */
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  coerceTtsConfigForBrowserPlayback,
  resolveSpeechSynthesisConfigAsync,
  resolveTranscriptionConfigAsync,
  sanitizeTextForTts,
  synthesizeSpeechMulti,
  transcribeAudio,
  type RuntimePreferences,
} from "@liminal/core";
import {
  findAudioAttachment,
  normalizeAudioMimeType,
  readAudioAttachment,
  saveAudioAttachment,
  SUPPORTED_AUDIO_MIME_TYPES,
} from "./audio_attachments.js";
import { readTtsClip, saveTtsClip, ttsClipAudioUrl } from "./tts_clips.js";

export interface AudioBridgeContext {
  chatId: string;
  getRuntimePreferences: () => RuntimePreferences | null;
  signal?: AbortSignal;
}

/** Response close means cancellation; request close alone also happens after a normal POST body. */
export function audioRequestCancellation(req: IncomingMessage, res: ServerResponse): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!res.writableEnded) abort(); };
  req.once("aborted", abort); res.once("close", close);
  if (req.aborted || res.destroyed) abort();
  return { signal: controller.signal, dispose: () => { req.off("aborted", abort); res.off("close", close); } };
}

export type AudioHandlerResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: { error: string } };

export function sanitizeAudioFilename(raw: string): string {
  const base = path.basename(String(raw ?? "").trim());
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  const trimmed = cleaned.slice(0, 120);
  return trimmed || `audio-${Date.now()}.webm`;
}

export async function handleAudioUpload(
  bridge: AudioBridgeContext,
  body: { dataUrl?: string; filename?: string; mimeType?: string }
): Promise<AudioHandlerResult> {
  const dataUrl = String(body.dataUrl ?? "").trim();
  if (!dataUrl.startsWith("data:")) {
    return { ok: false, status: 400, body: { error: "dataUrl required (data:<mime>;base64,<payload>)" } };
  }
  const base64Idx = dataUrl.indexOf(";base64,");
  if (base64Idx < 5) {
    return { ok: false, status: 400, body: { error: "Invalid data URL format (expected ;base64, segment)" } };
  }
  const fullMimeHeader = dataUrl.slice(5, base64Idx);
  const payload = dataUrl.slice(base64Idx + ";base64,".length);
  if (!fullMimeHeader || !payload) {
    return { ok: false, status: 400, body: { error: "Invalid data URL format" } };
  }
  const mimeFromUrl = normalizeAudioMimeType(fullMimeHeader);
  const bodyMime = typeof body.mimeType === "string" ? normalizeAudioMimeType(body.mimeType) : "";
  const mimeType = bodyMime && bodyMime === mimeFromUrl ? bodyMime : mimeFromUrl;
  if (!mimeType || !SUPPORTED_AUDIO_MIME_TYPES.has(mimeType)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: `Unsupported audio MIME: ${fullMimeHeader}. Supported: ${[...SUPPORTED_AUDIO_MIME_TYPES].join(", ")}`,
      },
    };
  }
  const bytes = Buffer.from(payload, "base64");
  const config = await resolveTranscriptionConfigAsync(bridge.getRuntimePreferences());
  if (bytes.byteLength > config.maxBytes) {
    return {
      ok: false,
      status: 413,
      body: {
        error: `Audio file ${bytes.byteLength} bytes exceeds AGENT_TRANSCRIBE_MAX_BYTES (${config.maxBytes}).`,
      },
    };
  }
  const filename = sanitizeAudioFilename(
    (typeof body.filename === "string" && body.filename.trim()) || `audio-${Date.now()}.webm`
  );
  const rec = await saveAudioAttachment(bridge.chatId, { bytes, filename, mimeType });
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      attachmentId: rec.id,
      filename: rec.filename,
      mimeType: rec.mimeType,
      sizeBytes: rec.sizeBytes,
      chatId: bridge.chatId,
    },
  };
}

export async function handleTranscribe(
  bridge: AudioBridgeContext,
  body: {
    attachmentId?: string;
    /** Provisional PCM WAV snapshots: never persisted as chat attachments. */
    previewWav?: string;
    language?: string;
    prompt?: string;
    timestamps?: "none" | "segment" | "word";
    model?: string;
  }
): Promise<AudioHandlerResult> {
  if (typeof body.previewWav === "string") {
    if (body.previewWav.length > 512_060) return { ok: false, status: 413, body: { error: "Preview is limited to 12 seconds of mono 16 kHz PCM WAV." } };
    const audio = Buffer.from(body.previewWav, "base64");
    if (audio.length < 44 || audio.length > 384_044 || audio.toString("ascii", 0, 4) !== "RIFF" ||
        audio.toString("ascii", 8, 16) !== "WAVEfmt " || audio.readUInt32LE(16) !== 16 ||
        audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1 || audio.readUInt32LE(24) !== 16000 ||
        audio.readUInt16LE(34) !== 16 || audio.toString("ascii", 36, 40) !== "data" ||
        audio.readUInt32LE(40) !== audio.length - 44 || (audio.length - 44) % 2 !== 0) {
      return { ok: false, status: 400, body: { error: "Preview requires mono PCM16 WAV at 16 kHz, up to 12 seconds." } };
    }
    const config = await resolveTranscriptionConfigAsync(bridge.getRuntimePreferences());
    if (!config.model.startsWith("local/")) return { ok: false, status: 400, body: { error: "Live previews require a local transcription model." } };
    const result = await transcribeAudio({ audio, filename: "preview.wav", language: body.language, timestamps: "none", signal: bridge.signal }, config);
    return { ok: true, status: 200, body: { ok: true, ...result, provisional: true } };
  }
  const id = String(body.attachmentId ?? "").trim();
  if (!id) {
    return { ok: false, status: 400, body: { error: "attachmentId required (upload first via /api/audio/upload)" } };
  }
  const found = await findAudioAttachment(bridge.chatId, id);
  if (!found) {
    return { ok: false, status: 404, body: { error: `Audio attachment ${id} not found for this chat.` } };
  }
  const { record, bytes } = await readAudioAttachment(bridge.chatId, id);
  const config = await resolveTranscriptionConfigAsync(bridge.getRuntimePreferences());
  if (!config.enabled) {
    return { ok: false, status: 503, body: { error: "Transcription disabled (AGENT_TRANSCRIBE_ENABLED=0)." } };
  }
  const result = await transcribeAudio(
    {
      signal: bridge.signal,
      audio: bytes,
      filename: record.filename,
      language: body.language?.trim() || undefined,
      prompt: body.prompt?.slice(0, 1500),
      timestamps:
        body.timestamps === "none" || body.timestamps === "word" || body.timestamps === "segment"
          ? body.timestamps
          : undefined,
      model: body.model?.trim() || undefined,
    },
    config
  );
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      attachmentId: id,
      text: result.text,
      noSpeech: result.noSpeech ?? !result.text,
      languageConfidence: result.languageConfidence,
      segments: result.segments,
      words: result.words,
      language: result.language,
      durationSec: result.durationSec,
      costUsd: result.costUsd,
      model: result.model,
      provider: result.provider,
    },
  };
}

export async function handleTtsPost(
  bridge: AudioBridgeContext,
  body: { text?: string; voice?: string }
): Promise<AudioHandlerResult> {
  bridge.signal?.throwIfAborted();
  const raw = String(body.text ?? "").trim();
  if (!raw) {
    return { ok: false, status: 400, body: { error: "text required" } };
  }
  const config = await resolveSpeechSynthesisConfigAsync(bridge.getRuntimePreferences());
  if (!config.enabled) {
    return { ok: false, status: 400, body: { error: "TTS is disabled (AGENT_TTS_ENABLED=0)." } };
  }
  const sanitized = sanitizeTextForTts(raw, config.maxCharsPerCall);
  if (!sanitized) {
    return { ok: false, status: 400, body: { error: "Nothing to speak after sanitization." } };
  }
  const multi = await synthesizeSpeechMulti(
    { text: sanitized, voice: body.voice?.trim() || undefined, signal: bridge.signal },
    coerceTtsConfigForBrowserPlayback(config)
  );
  const clips = [];
  for (const seg of multi.segments) {
    bridge.signal?.throwIfAborted();
    const saved = await saveTtsClip(bridge.chatId, seg.audio, seg.mimeType, seg.spokenText, JSON.stringify([seg.provider, seg.model, seg.voice]));
    bridge.signal?.throwIfAborted();
    clips.push({
      clipId: saved.clipId,
      audioUrl: ttsClipAudioUrl(saved.clipId),
      text: seg.spokenText,
      cacheHit: saved.cacheHit,
    });
  }
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      segments: clips.length,
      clips,
      charCount: multi.charCount,
      costUsd: multi.costUsd,
    },
  };
}

export async function readTtsClipBytes(
  bridge: AudioBridgeContext,
  clipId: string
): Promise<{ mimeType: string; bytes: Buffer } | null> {
  return readTtsClip(bridge.chatId, clipId);
}
