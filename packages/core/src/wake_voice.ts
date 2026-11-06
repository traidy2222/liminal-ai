import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

export interface WakeVoiceConfig {
  enabled: boolean;
  phrase: string;
  idleTimeoutMs: number;
}

export function resolveWakeVoiceConfig(prefs: RuntimePreferences | null): WakeVoiceConfig {
  const raw = resolveHarnessEnvRaw("AGENT_WAKE_WORD_PHRASE", prefs)?.trim().replace(/\s+/g, " ") ?? "";
  const phrase = raw.length >= 2 && raw.length <= 80 && /[\p{L}\p{N}]/u.test(raw) ? raw : "Hey Jarvis";
  const timeoutRaw = resolveHarnessEnvRaw("AGENT_WAKE_WORD_IDLE_SECONDS", prefs)?.trim();
  const timeout = timeoutRaw ? Number(timeoutRaw) : NaN;
  return {
    enabled: resolveHarnessEnvRaw("AGENT_WAKE_WORD_ENABLED", prefs) === "1",
    phrase,
    idleTimeoutMs: Number.isFinite(timeout) ? Math.max(10000, Math.min(300000, Math.round(timeout * 1000))) : 45000,
  };
}
