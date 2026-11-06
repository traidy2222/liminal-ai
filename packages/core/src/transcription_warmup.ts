import { resolveTranscriptionConfig } from "./transcription.js";
import { isLocalTranscriptionModel, LOCAL_WHISPER_MODEL } from "./transcription_models.js";
import { resolveWakeVoiceConfig } from "./wake_voice.js";
import { retainLocalSpeech, warmupLocalSpeech } from "./local_speech.js";
import { resolveSpeechSynthesisConfig } from "./speech_synthesis.js";
import { isLocalSpeechModel } from "./speech_models.js";
import { closeLocalTranscription, retainLocalTranscription, warmupLocalTranscription } from "./local_transcription.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

/** Best-effort startup task: never block the UI, download models, or contact a provider. */
export async function warmupConfiguredTranscription(prefs: RuntimePreferences | null,
  warmup = warmupLocalTranscription, warmSpeech = warmupLocalSpeech): Promise<boolean> {
  const config = resolveTranscriptionConfig(prefs);
  const wake = resolveWakeVoiceConfig(prefs).enabled;
  if (wake) config.model = LOCAL_WHISPER_MODEL;
  const localTranscription = config.enabled && isLocalTranscriptionModel(config.model);
  // Only always-on wake listening needs a decoder resident indefinitely.
  // Dictation still preloads at launch, then frees its runtime after idle.
  retainLocalTranscription(wake && localTranscription);
  const speech = resolveSpeechSynthesisConfig(prefs);
  const keepVoice = wake && config.enabled && speech.enabled && isLocalSpeechModel(speech.model);
  retainLocalSpeech(keepVoice);
  if (keepVoice) {
    try { void warmSpeech().catch(() => {}); } catch { /* Setup errors surface when used. */ }
  }
  if (!localTranscription) { closeLocalTranscription(); return false; }
  try { await warmup(config.model, config.timeoutMs); return true; }
  catch { return false; /* Dictation surfaces actionable setup/decode errors on use. */ }
}
