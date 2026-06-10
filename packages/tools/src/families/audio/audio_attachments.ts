/**
 * Per-chat audio attachment storage.
 *
 * Mirrors the existing image_attachment_store pattern but lives under the
 * per-chat dir from Phase 2 storage split, so audio uploads:
 *   - travel with the chat (memory continuity for "what did I send last time?")
 *   - get cleaned up automatically on chat delete
 *   - never pollute the user's project folder when the chat is in folder mode
 *
 * Files are deduped by content hash so re-uploading the same clip doesn't
 * accumulate. Returns a stable handle the agent can pass to `transcribe_audio`.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { perChatPath } from "@liminal/core";

/**
 * Supported audio MIME types — anything the OpenAI-compatible transcription
 * APIs accept. Includes video/mp4 because podcast/screencast uploads often
 * arrive as mp4 with the audio track being what the user actually wants.
 */
/** Strip `;codecs=opus` and similar — MediaRecorder uses parameterized MIME types. */
export function normalizeAudioMimeType(mime: string): string {
  const base = String(mime ?? "")
    .trim()
    .toLowerCase()
    .split(";")[0]
    ?.trim();
  return base ?? "";
}

export const SUPPORTED_AUDIO_MIME_TYPES: ReadonlySet<string> = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/oga",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/flac",
  "audio/aac",
  "video/mp4",
  "video/webm",
]);

export interface AudioAttachmentInput {
  /** Bytes of the audio file. */
  bytes: Buffer | Uint8Array;
  /** Original filename (just for display; extension drives content type). */
  filename: string;
  /** MIME type from the upload. Validated against SUPPORTED_AUDIO_MIME_TYPES. */
  mimeType: string;
}

export interface AudioAttachmentRecord {
  /** Stable id — content hash truncated to 16 hex chars. */
  id: string;
  /** Absolute path on disk under the per-chat audio dir. */
  path: string;
  /** Original filename from upload (for UI display only). */
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

const AUDIO_SUBDIR = "audio";

/** Resolve the per-chat audio directory (creates it on demand). */
async function audioDirFor(chatId: string): Promise<string> {
  const dir = perChatPath(chatId, AUDIO_SUBDIR);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

/** Pick a filename-safe extension from the MIME type for on-disk storage. */
function extForMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg") || m.includes("oga")) return "ogg";
  if (m.includes("m4a")) return "m4a";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("flac")) return "flac";
  if (m.includes("aac")) return "aac";
  return "bin";
}

/**
 * Persist an uploaded audio file under the per-chat audio dir. Deduped by
 * content hash — uploading the same bytes twice reuses the same record.
 */
export async function saveAudioAttachment(
  chatId: string,
  input: AudioAttachmentInput
): Promise<AudioAttachmentRecord> {
  const normalizedMime = normalizeAudioMimeType(input.mimeType);
  if (!normalizedMime || !SUPPORTED_AUDIO_MIME_TYPES.has(normalizedMime)) {
    throw new Error(
      `Unsupported audio MIME type: ${input.mimeType}. Supported: ${[...SUPPORTED_AUDIO_MIME_TYPES].join(", ")}`
    );
  }
  const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const ext = extForMime(normalizedMime);
  const dir = await audioDirFor(chatId);
  const targetPath = path.join(dir, `${hash}.${ext}`);
  if (!existsSync(targetPath)) {
    await writeFile(targetPath, bytes);
  }
  const s = await stat(targetPath);
  return {
    id: hash,
    path: targetPath,
    filename: input.filename,
    mimeType: normalizedMime,
    sizeBytes: s.size,
    createdAt: new Date(s.ctimeMs).toISOString(),
  };
}

/** Resolve an attachment id back to its absolute path under the per-chat dir. */
export async function findAudioAttachment(
  chatId: string,
  attachmentId: string
): Promise<AudioAttachmentRecord | null> {
  const dir = await audioDirFor(chatId);
  const safeId = attachmentId.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeId) return null;
  // Try each known extension.
  for (const ext of ["mp3", "wav", "webm", "ogg", "m4a", "mp4", "flac", "aac", "bin"]) {
    const candidate = path.join(dir, `${safeId}.${ext}`);
    if (existsSync(candidate)) {
      const s = await stat(candidate);
      return {
        id: safeId,
        path: candidate,
        filename: `${safeId}.${ext}`,
        mimeType: `audio/${ext === "mp3" ? "mpeg" : ext}`,
        sizeBytes: s.size,
        createdAt: new Date(s.ctimeMs).toISOString(),
      };
    }
  }
  return null;
}

/** Read bytes for a stored attachment. */
export async function readAudioAttachment(
  chatId: string,
  attachmentId: string
): Promise<{ record: AudioAttachmentRecord; bytes: Buffer }> {
  const record = await findAudioAttachment(chatId, attachmentId);
  if (!record) {
    throw new Error(`Audio attachment ${attachmentId} not found for chat ${chatId}.`);
  }
  const bytes = await readFile(record.path);
  return { record, bytes };
}
