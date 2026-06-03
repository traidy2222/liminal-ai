/**
 * `transcribe_audio` — speech-to-text via the cheapest configured ASR model.
 *
 * Belongs to the `audio` tool family (lazy-loaded). When the user attaches an
 * audio file, the chat server auto-activates this family before the model's
 * first round.
 *
 * Sources accepted (mutually exclusive):
 *   - `attachment_id` — a previously-uploaded audio attachment (most common)
 *   - `path`          — absolute path to an audio file on disk
 *   - `url`           — HTTP(S) URL the server fetches before transcribing
 *
 * Cost is computed locally from the duration the API returns and included in
 * the tool result so the agent stays cost-aware across rounds.
 */
import type { AgentHarness } from "@liminal/core";
import {
  resolveTranscriptionConfigAsync,
  transcribeAudio,
} from "@liminal/core";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "./helpers.js";
import { findAudioAttachment, readAudioAttachment } from "./audio_attachments.js";

const MAX_FETCH_BYTES = 50 * 1024 * 1024; // 50 MB hard cap on URL fetches

/**
 * Build the transcribe tool — needs the harness so it can scope reads to the
 * chat's audio dir (chat-aware) and use the harness's runtime preferences for
 * model/provider resolution.
 */
export function createTranscribeAudioTool(harness: AgentHarness) {
  return defineTool({
    name: "transcribe_audio",
    description:
      "WHAT: Transcribe an audio (or audio track from video) file to text using the configured ASR model.\n" +
      "Cheapest model by default (Whisper Large V3 Turbo @ $0.04/hour). Supports mp3, wav, m4a, " +
      "webm, ogg, flac, mp4, aac.\n" +
      "WHEN: User uploads a voice note / meeting / podcast / lecture; or `web_fetch` returns an audio URL.\n" +
      "NOT WHEN: The audio is music-only with no speech (returns lyrics or empty), or the file is > 25 MB " +
      "(split it first).\n" +
      "ARGS: exactly one of attachment_id / path / url. Optional: language (ISO-639 hint or omit for auto), " +
      "prompt (proper-noun/jargon biasing), timestamps ('none'|'segment'|'word'), model (override default).\n" +
      "RETURNS: { text, language, durationSec, costUsd, model, segments? }.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        attachment_id: {
          type: "string",
          description:
            "ID of an uploaded audio attachment (returned by POST /api/audio/upload or " +
            "the chat client's mic recorder). Resolved against this chat's audio dir.",
        },
        path: {
          type: "string",
          description: "Absolute filesystem path to the audio file.",
        },
        url: {
          type: "string",
          description: "HTTP(S) URL the server will fetch before transcribing.",
        },
        language: {
          type: "string",
          description: "ISO-639 language hint (en, es, fr, zh, …). Omit for auto-detect.",
        },
        prompt: {
          type: "string",
          description:
            "Optional vocabulary biasing — short text containing names/jargon you expect in the audio.",
        },
        timestamps: {
          type: "string",
          enum: ["none", "segment", "word"],
          description: "Timestamp granularity in the response (default: segment).",
        },
        model: {
          type: "string",
          description:
            "Override the configured AGENT_TRANSCRIBE_MODEL (default nvidia/parakeet-tdt-0.6b-v3). " +
            "Alternatives: openai/whisper-large-v3-turbo (99 languages), qwen/qwen3-asr-flash (Chinese dialects).",
        },
      },
      additionalProperties: false,
    },
    handler: async (args, emit) => {
      const sources = [args["attachment_id"], args["path"], args["url"]].filter(
        (v) => typeof v === "string" && (v as string).trim().length > 0
      );
      if (sources.length === 0) {
        return { ok: false, error: "Provide exactly one of attachment_id / path / url." };
      }
      if (sources.length > 1) {
        return { ok: false, error: "Provide exactly one of attachment_id / path / url, not multiple." };
      }

      const config = await resolveTranscriptionConfigAsync(harness.getRuntimePreferences());
      if (!config.enabled) {
        return { ok: false, error: "Transcription disabled via AGENT_TRANSCRIBE_ENABLED=0." };
      }
      if (!config.apiKey) {
        return {
          ok: false,
          error:
            "No transcription API key configured. Set AGENT_TRANSCRIBE_API_KEY, AGENT_API_KEY, " +
            "or OPENROUTER_API_KEY in your .env.",
        };
      }

      let bytes: Buffer;
      let filename: string;

      try {
        if (typeof args["attachment_id"] === "string") {
          const id = args["attachment_id"].trim();
          const found = await findAudioAttachment(harness.taskId, id);
          if (!found) {
            return {
              ok: false,
              error: `Attachment ${id} not found for this chat. Upload via POST /api/audio/upload first.`,
            };
          }
          const r = await readAudioAttachment(harness.taskId, id);
          bytes = r.bytes;
          filename = r.record.filename;
          emit?.(`Transcribing ${filename} (${formatBytes(bytes.length)})…`);
        } else if (typeof args["path"] === "string") {
          const p = path.resolve(args["path"].trim());
          bytes = await readFile(p);
          filename = path.basename(p);
          if (bytes.length > config.maxBytes) {
            return {
              ok: false,
              error: `File ${filename} (${formatBytes(bytes.length)}) exceeds AGENT_TRANSCRIBE_MAX_BYTES (${formatBytes(config.maxBytes)}).`,
            };
          }
          emit?.(`Transcribing ${filename} (${formatBytes(bytes.length)})…`);
        } else if (typeof args["url"] === "string") {
          const url = args["url"].trim();
          emit?.(`Fetching ${url}…`);
          const resp = await fetch(url);
          if (!resp.ok) {
            return { ok: false, error: `Fetch failed: HTTP ${resp.status} ${resp.statusText}` };
          }
          const ab = await resp.arrayBuffer();
          if (ab.byteLength > MAX_FETCH_BYTES) {
            return {
              ok: false,
              error: `URL fetch exceeded ${formatBytes(MAX_FETCH_BYTES)}. Save it locally and pass via path.`,
            };
          }
          bytes = Buffer.from(ab);
          // Try to derive a sensible filename from the URL path.
          try {
            const u = new URL(url);
            filename = path.basename(u.pathname) || "remote-audio.mp3";
          } catch {
            filename = "remote-audio.mp3";
          }
          emit?.(`Transcribing ${filename} (${formatBytes(bytes.length)})…`);
        } else {
          return { ok: false, error: "internal: source dispatch fell through" };
        }
      } catch (err) {
        return { ok: false, error: `Failed to load audio: ${(err as Error).message}` };
      }

      const language = typeof args["language"] === "string" ? args["language"].trim() : undefined;
      const prompt = typeof args["prompt"] === "string" ? args["prompt"].trim().slice(0, 1500) : undefined;
      const timestamps =
        args["timestamps"] === "none" || args["timestamps"] === "word" || args["timestamps"] === "segment"
          ? (args["timestamps"] as "none" | "segment" | "word")
          : undefined;
      const modelOverride =
        typeof args["model"] === "string" && args["model"].trim().length > 0
          ? args["model"].trim()
          : undefined;

      try {
        const result = await transcribeAudio(
          {
            audio: bytes,
            filename,
            language,
            prompt,
            timestamps,
            model: modelOverride,
          },
          config
        );
        const durationStr = result.durationSec ? formatDuration(result.durationSec) : "?";
        const costStr =
          result.costUsd > 0 ? `$${result.costUsd.toFixed(5)}` : "(cost unknown)";
        emit?.(`✓ Transcribed ${durationStr} via ${result.model} · ${costStr}`);
        const body: Record<string, unknown> = {
          text: result.text,
          language: result.language,
          durationSec: result.durationSec,
          costUsd: result.costUsd,
          model: result.model,
          provider: result.provider,
          source: { attachment_id: args["attachment_id"], path: args["path"], url: args["url"] },
        };
        if (result.segments && (timestamps === "segment" || timestamps === "word")) {
          body["segments"] = result.segments;
        }
        return { ok: true, output: JSON.stringify(body, null, 2) };
      } catch (err) {
        return {
          ok: false,
          error: `Transcription failed: ${(err as Error).message}`,
        };
      }
    },
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(sec: number): string {
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
