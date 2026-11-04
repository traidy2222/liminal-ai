/** Canonical on-device ASR choices. Cloud slugs remain available only when explicitly selected. */
export const LOCAL_WHISPER_MODEL = "local/whisper-large-v3-turbo";
export const LOCAL_QWEN_MODEL = "local/qwen3-asr-1.7b";
export function isLocalTranscriptionModel(model: string): boolean {
  return [LOCAL_WHISPER_MODEL, LOCAL_QWEN_MODEL].includes(model.trim().toLowerCase());
}
export function transcriptionProfile(model: string): "whisper" | "qwen" {
  if (!isLocalTranscriptionModel(model)) throw new Error(`Unknown local transcription model: ${model}`);
  return model.trim().toLowerCase() === LOCAL_QWEN_MODEL ? "qwen" : "whisper";
}
