/**
 * Shared audio upload / transcribe / TTS handlers for web Express and sidecar HTTP.
 */
import path from "node:path";
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
    language?: string;
    prompt?: string;
    timestamps?: "none" | "segment" | "word";
    model?: string;
  }
): Promise<AudioHandlerResult> {
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
  if (!config.apiKey) {
    return {
      ok: false,
      status: 503,
      body: {
        error: "No transcription API key. Set AGENT_TRANSCRIBE_API_KEY, AGENT_API_KEY, or OPENROUTER_API_KEY.",
      },
    };
  }
  const result = await transcribeAudio(
    {
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
    { text: sanitized, voice: body.voice?.trim() || undefined },
    coerceTtsConfigForBrowserPlayback(config)
  );
  const clips = [];
  for (const seg of multi.segments) {
    const saved = await saveTtsClip(bridge.chatId, seg.audio, seg.mimeType, seg.spokenText);
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
