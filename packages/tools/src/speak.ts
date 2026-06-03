/**
 * `speak` — brief spoken updates on the TTS channel (web playback).
 *
 * Does not add text to the chat transcript; emits a `speech` harness event
 * with a cached audio clip URL.
 */
import type { AgentHarness, SpeechSynthesisConfig } from "@liminal/core";
import {
  coerceTtsConfigForBrowserPlayback,
  resolveCurrentChatId,
  resolveSpeechSynthesisConfigAsync,
  synthesizeSpeechMulti,
} from "@liminal/core";
import { defineTool } from "./helpers.js";
import { saveTtsClip, ttsClipAudioUrl } from "./tts_clips.js";

/** Synthesize + emit speech events (shared by speak() and voice-mode turn-end fallback). */
export async function emitSpokenClips(
  harness: AgentHarness,
  rawText: string,
  cfg: SpeechSynthesisConfig
): Promise<{ ok: true; segments: number; charCount: number; costUsd: number } | { ok: false; reason: string }> {
  const gate = harness.ttsTurnBudget.tryConsume(rawText, cfg);
  if (!gate.ok) {
    return { ok: false, reason: gate.reason ?? "TTS budget rejected this line." };
  }
  const chatId = resolveCurrentChatId() ?? harness.taskId;
  const multi = await synthesizeSpeechMulti(
    { text: gate.sanitizedText! },
    coerceTtsConfigForBrowserPlayback(cfg)
  );
  for (const seg of multi.segments) {
    const saved = await saveTtsClip(chatId, seg.audio, seg.mimeType, seg.spokenText);
    harness.emitter.emit("speech", {
      clipId: saved.clipId,
      text: seg.spokenText,
      audioUrl: ttsClipAudioUrl(saved.clipId),
      costUsd: seg.costUsd,
    });
  }
  return {
    ok: true,
    segments: multi.segments.length,
    charCount: multi.charCount,
    costUsd: multi.costUsd,
  };
}

/** Turn-end fallback when the model skips speak() during a mic session. */
export function installVoiceTtsFallback(harness: AgentHarness): void {
  harness.voiceTtsFallback = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 12) return;
    if (/^```|^#\s|^\[HARNESS\]/m.test(trimmed)) return;
    const cfg = await resolveSpeechSynthesisConfigAsync(harness.getRuntimePreferences());
    if (!cfg.enabled || !harness.isLiveDictationTurn()) return;
    await emitSpokenClips(harness, trimmed, cfg);
  };
}

export function createSpeakTool(harness: AgentHarness) {
  return defineTool({
    name: "speak",
    description:
      "WHAT: Speak a short line you author aloud (Jarvis-style), separate from your written reply. Only this tool produces audio.\n" +
      "WHEN: TTS is on and a brief, situation-specific cue helps (≤2 sentences). Write fresh wording for this turn — not generic status templates.\n" +
      "NOT WHEN: The line is code, a long recap, stock filler, or duplicates what you already spoke this turn.\n" +
      "ARGS: text — spoken line (up to 4096 chars after sanitization; prefer one full utterance in voice mode).",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Short line to speak aloud" },
      },
      required: ["text"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const raw = String(args["text"] ?? "").trim();
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
        const spoken = await emitSpokenClips(harness, raw, cfg);
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
