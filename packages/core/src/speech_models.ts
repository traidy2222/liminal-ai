/** Explicitly selected, on-device voice; never routed through a cloud inference provider. */
export const LOCAL_WARM_VOICE_MODEL = "local/jarvis-warm";
export const LOCAL_WARM_VOICE_ID = "jarvis-warm-v1";
export function isLocalSpeechModel(model: string): boolean {
  return model.trim().toLowerCase() === LOCAL_WARM_VOICE_MODEL;
}
