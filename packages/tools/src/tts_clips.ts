/**
 * Per-chat TTS clip cache — deduped by content hash of spoken text.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { perChatPath } from "@liminal/core";

const TTS_SUBDIR = "tts";
/** Bump when clip hashing or synthesis semantics change (invalidates stale truncated cache). */
const TTS_CLIP_CACHE_VERSION = 2;

function extForMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("opus")) return "opus";
  if (m.includes("flac")) return "flac";
  return "bin";
}

async function ttsDirFor(chatId: string): Promise<string> {
  const dir = perChatPath(chatId, TTS_SUBDIR);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

export interface SavedTtsClip {
  clipId: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  cacheHit: boolean;
}

/**
 * Persist synthesized audio under the chat's tts dir. Reuses clip when the same
 * normalized text was already synthesized (hash id).
 */
export async function saveTtsClip(
  chatId: string,
  audio: Uint8Array,
  mimeType: string,
  spokenText: string
): Promise<SavedTtsClip> {
  const hash = createHash("sha256")
    .update(`v${TTS_CLIP_CACHE_VERSION}:${spokenText.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
  const clipId = hash;
  const dir = await ttsDirFor(chatId);
  const ext = extForMime(mimeType);
  const filePath = path.join(dir, `${clipId}.${ext}`);
  if (existsSync(filePath)) {
    const existing = await readFile(filePath);
    return {
      clipId,
      path: filePath,
      mimeType,
      sizeBytes: existing.length,
      cacheHit: true,
    };
  }
  await writeFile(filePath, audio);
  return {
    clipId,
    path: filePath,
    mimeType,
    sizeBytes: audio.byteLength,
    cacheHit: false,
  };
}

export async function readTtsClip(
  chatId: string,
  clipId: string
): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const safe = clipId.replace(/[^a-f0-9]/gi, "");
  if (!safe) return null;
  const dir = perChatPath(chatId, TTS_SUBDIR);
  for (const ext of ["mp3", "wav", "opus", "flac", "bin"]) {
    const filePath = path.join(dir, `${safe}.${ext}`);
    if (!existsSync(filePath)) continue;
    const bytes = await readFile(filePath);
    const mimeType =
      ext === "mp3"
        ? "audio/mpeg"
        : ext === "wav"
          ? "audio/wav"
          : ext === "opus"
            ? "audio/opus"
            : ext === "flac"
              ? "audio/flac"
              : "application/octet-stream";
    return { bytes, mimeType };
  }
  return null;
}

/** Relative URL path served by the web server. */
export function ttsClipAudioUrl(clipId: string): string {
  return `/api/tts/clip/${encodeURIComponent(clipId)}`;
}
