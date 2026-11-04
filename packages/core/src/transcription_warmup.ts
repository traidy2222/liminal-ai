import { resolveTranscriptionConfig } from "./transcription.js";
import { isLocalTranscriptionModel } from "./transcription_models.js";
import { warmupLocalTranscription } from "./local_transcription.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

/** Best-effort startup task: never block the UI, download models, or contact a provider. */
export async function warmupConfiguredTranscription(prefs: RuntimePreferences | null,
  warmup = warmupLocalTranscription): Promise<boolean> {
  const config = resolveTranscriptionConfig(prefs);
  if (!config.enabled || !isLocalTranscriptionModel(config.model)) return false;
  try { await warmup(config.model, config.timeoutMs); return true; }
  catch { return false; /* Dictation surfaces actionable setup/decode errors on use. */ }
}
