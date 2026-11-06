/**
 * `speak` — brief spoken updates on the TTS channel (web playback).
 *
 * Does not add text to the chat transcript; emits a `speech` harness event
 * with a cached audio clip URL.
 */
import type { AgentHarness, SpeechSynthesisConfig } from "@liminal/core";
import { randomUUID } from "node:crypto";
import {
  coerceTtsConfigForBrowserPlayback,
  resolveCurrentChatId,
  resolveSpeechSynthesisConfigAsync,
  resolveSpeechSynthesisConfig,
  VoiceTextStream,
  synthesizeSpeechMulti,
} from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { saveTtsClip, ttsClipAudioUrl } from "./tts_clips.js";

/** Synthesize + emit speech events (shared by speak() and voice-mode turn-end fallback). */
export async function emitSpokenClips(
  harness: AgentHarness,
  rawText: string,
  cfg: SpeechSynthesisConfig,
  signal?: AbortSignal
): Promise<{ ok: true; segments: number; charCount: number; costUsd: number } | { ok: false; reason: string }> {
  signal?.throwIfAborted();
  const gate = harness.ttsTurnBudget.tryConsume(rawText, cfg);
  if (!gate.ok) {
    return { ok: false, reason: gate.reason ?? "TTS budget rejected this line." };
  }
  return emitSpokenSegments(harness, gate.sanitizedText!, cfg, signal);
}

async function emitSpokenSegments(harness: AgentHarness, text: string, cfg: SpeechSynthesisConfig, signal?: AbortSignal, voiceId?: string) {
  const chatId = resolveCurrentChatId() ?? harness.taskId;
  const multi = await synthesizeSpeechMulti(
    { text, signal, keepWorkerOnCancel: Boolean(voiceId) },
    coerceTtsConfigForBrowserPlayback(cfg),
    async seg => {
    signal?.throwIfAborted();
    const saved = await saveTtsClip(chatId, seg.audio, seg.mimeType, seg.spokenText, JSON.stringify([seg.provider, seg.model, seg.voice]));
    signal?.throwIfAborted();
    harness.emitter.emit("speech", {
      ...(voiceId ? { voiceId } : {}),
      clipId: saved.clipId,
      text: seg.spokenText,
      audioUrl: ttsClipAudioUrl(saved.clipId),
      costUsd: seg.costUsd,
    });
    }
  );
  return {
    ok: true as const,
    segments: multi.segments.length,
    charCount: multi.charCount,
    costUsd: multi.costUsd,
  };
}

/** Turn-end fallback when the model skips speak() during a mic session. */
export function installVoiceTtsFallback(harness: AgentHarness): void {
  if (harness.voiceTtsStream) return;
  let stream: VoiceTextStream | undefined;
  let removeAbort: (() => void) | undefined;
  let voiceId: string | undefined;
  harness.voiceTtsStream = {
    get id() { return voiceId; },
    reset(signal) {
      stream?.cancel(); removeAbort?.(); stream = undefined;
      const id = voiceId = randomUUID();
      const configured = resolveSpeechSynthesisConfig(harness.getRuntimePreferences());
      if (!configured.enabled || !harness.isLiveDictationTurn() || signal.aborted) return;
      let config: Promise<SpeechSynthesisConfig> | undefined;
      let consumed = false;
      const current = new VoiceTextStream(async (text, audioSignal) => {
        const cfg = await (config ??= resolveSpeechSynthesisConfigAsync(harness.getRuntimePreferences()));
        if (!consumed) {
          const gate = harness.ttsTurnBudget.tryConsume(text, cfg);
          if (!gate.ok) throw new Error(gate.reason);
          consumed = true;
        }
        await emitSpokenSegments(harness, text, cfg, audioSignal, id);
      }, error => harness.emitter.emit('text', {channel: 'trace', delta: `\n[HARNESS] Speech playback failed: ${String(error)}\n`}), configured.maxCharsPerCall);
      stream = current;
      const abort = () => current.cancel();
      signal.addEventListener('abort', abort, {once: true});
      removeAbort = () => signal.removeEventListener('abort', abort);
    },
    async finish(fallbackText) {
      const current = stream;
      if (!current) return;
      if (!current.hasText) current.push(fallbackText);
      await current.finish();
      // Keep the abort listener until the next reset so queued/late cancellation
      // cannot revive an older voice response.
    },
    cancel() { stream?.cancel(); removeAbort?.(); },
  };
  harness.emitter?.on('text', ({channel, delta}) => {
    if (channel === 'user' && harness.isLiveDictationTurn()) stream?.push(delta);
  });
  harness.emitter?.on('tool_start', () => {
    // End a commentary phrase at a tool boundary instead of joining it to the
    // later result narration. The audio queue continues without blocking tools.
    if (harness.isLiveDictationTurn()) void stream?.finish();
  });
  harness.voiceTtsFallback = async (text: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const trimmed = text.trim();
    if (trimmed.length < 12) return;
    if (/^```|^#\s|^\[HARNESS\]/m.test(trimmed)) return;
    const cfg = await resolveSpeechSynthesisConfigAsync(harness.getRuntimePreferences());
    if (!cfg.enabled || !harness.isLiveDictationTurn()) return;
    await emitSpokenClips(harness, trimmed, cfg, signal);
  };
}

export function createSpeakTool(harness: AgentHarness) {
  return defineTool({
    name: "speak",
    description:
      "WHAT: Request an explicit short spoken line. Normal voice replies stream automatically from conversational text.\n" +
      "WHEN: TTS is on and a brief, situation-specific cue helps (≤2 sentences). Write fresh wording for this turn — not generic status templates.\n" +
      "NOT WHEN: The line is code, a long recap, stock filler, or duplicates what you already spoke this turn.\n" +
      "ARGS: text (required — NOT content/think) — spoken line (up to 4096 chars after sanitization; prefer one full utterance in voice mode).",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Short line to speak aloud" },
      },
      required: ["text"],
      additionalProperties: false,
    },
    handler: async (args, _emit, _harness, context) => {
      const raw = String(args["text"] ?? args["content"] ?? "").trim();
      if (!raw) {
        return { ok: false, error: "text is required" };
      }
      const prefs = harness.getRuntimePreferences();
      const cfg = await resolveSpeechSynthesisConfigAsync(prefs);
      if (!cfg.enabled) {
        return { ok: false, error: "TTS is disabled (AGENT_TTS_ENABLED=0)." };
      }
      if (!harness.isLiveDictationTurn()) {
        return {
          ok: false,
          error: "Voice mode is off — enable the mic session for spoken replies.",
        };
      }
      try {
        const spoken = await emitSpokenClips(harness, raw, cfg, context?.signal);
        if (!spoken.ok) {
          return { ok: false, error: spoken.reason };
        }
        return {
          ok: true,
          output: JSON.stringify({
            segments: spoken.segments,
            charCount: spoken.charCount,
            costUsd: spoken.costUsd,
            voiceMode: true,
          }),
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
