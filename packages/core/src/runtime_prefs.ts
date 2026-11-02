import { readFile, writeFile, mkdir } from "node:fs/promises";
import path, { join } from "node:path";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import {
  ensureGlobalStorageRoot,
  pickReadPath,
  pickWritePath,
  runtimePrefsPaths,
} from "./global_storage.js";

export type ProviderKeySource =
  | "AGENT_API_KEY"
  | "OPENROUTER_API_KEY"
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "XAI_API_KEY";

export interface RuntimePersonaSpeechStyle {
  sentenceStructure: string;
  formality: "very_formal" | "formal" | "casual" | "very_casual" | "mixed";
  /** Descriptive prose for the vocabulary world / diction this voice draws from — never a list of words to inject. */
  register: string;
  avoidWords: string[];
  rhythm: string;
}

export interface RuntimePersonaTone {
  confidence: number;
  humorStyle: string;
  aggression: number;
  emotionalFlavor: string;
  posture: string;
}

export interface RuntimePersonaProfile {
  name: string;
  coreIdentity: string;
  background: string;
  selfImage: string;
  speechStyle: RuntimePersonaSpeechStyle;
  tone: RuntimePersonaTone;
  thinkingStyle: string;
  decisionFramework: string;
  neverDo: string[];
  alwaysDo: string[];
  strength: number;
  modifier?: string;
  /** Verbatim slice of user's persona request for surface fidelity (optional). */
  generationSourceHint?: string;
}

export interface RuntimePersonaControls {
  humorPercent?: number;
  formality?: RuntimePersonaSpeechStyle["formality"];
  confidence?: number;
  verbosity?: "compact" | "normal" | "detailed";
  personaStrength?: number;
}

export interface RuntimePersonaPreferences {
  bootstrapCompleted?: boolean;
  sourcePrompt?: string;
  activeProfile?: RuntimePersonaProfile | null;
  controls?: RuntimePersonaControls;
  updatedAt?: number;
}

export interface RuntimeHarnessPreferences {
  /** Sparse non-secret overrides for `AGENT_*` keys (see `HARNESS_MANAGED_ENV_KEYS`). */
  env?: Record<string, string>;
}

export type InferenceModePreference = "byok" | "managed" | "auto";

export interface RuntimePreferences {
  version: 1;
  provider?: {
    model?: string;
    baseURL?: string;
    keySource?: ProviderKeySource;
    /** BYOK vs Vireon-managed inference routing (see AGENT_INFERENCE_MODE). */
    inferenceMode?: InferenceModePreference;
  };
  runtime?: {
    uiVerbosity?: "normal" | "quiet";
    vaultAutoWriteMode?: "off" | "research" | "aggressive";
    approvalTimeoutMs?: number;
    /** @deprecated Stored for compatibility; no longer applied (think/plan preflight removed). */
    destructiveGate?: "strict" | "balanced";
    rateLimitMaxRetries?: number;
    transient5xxMaxRetries?: number;
    retryMaxDelayMs?: number;
  };
  harness?: RuntimeHarnessPreferences;
  persona?: RuntimePersonaPreferences;
  updatedAt: number;
}

export const RUNTIME_PREFS_FILE = ".agent_runtime_prefs.json";

/**
 * Synchronous legacy path resolver — kept for callers that need a stable path
 * string without async lookup (currently none in the harness). New code should
 * prefer `runtimePrefsPaths()` from global_storage which returns both the new
 * `~/.liminal/runtime_prefs.json` and the legacy fallback.
 */
export function getRuntimePrefsPath(workspaceRoot?: string): string {
  const root = workspaceRoot ? workspaceRoot : resolveWorkspaceRoot();
  return join(root, RUNTIME_PREFS_FILE);
}

export async function loadRuntimePreferences(
  workspaceRoot?: string
): Promise<RuntimePreferences | null> {
  // Phase 1 storage split: prefer ~/.liminal/runtime_prefs.json; fall back to
  // the legacy workspace-local .agent_runtime_prefs.json when global is unset.
  const filePath = await pickReadPath(runtimePrefsPaths(workspaceRoot));
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as RuntimePreferences;
    if (parsed && parsed.version === 1) return parsed;
    return null;
  } catch {
    return null;
  }
}

export async function saveRuntimePreferences(
  prefs: RuntimePreferences,
  workspaceRoot?: string
): Promise<string> {
  await ensureGlobalStorageRoot();
  const filePath = await pickWritePath(runtimePrefsPaths(workspaceRoot));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(prefs, null, 2), "utf8");
  return filePath;
}

/** Deep-merge a sparse prefs patch (sidecar settings saves). */
export function mergeRuntimePreferences(
  base: RuntimePreferences | null,
  patch: Partial<RuntimePreferences>
): RuntimePreferences {
  const prev = base ?? { version: 1, updatedAt: Date.now() };
  return {
    ...prev,
    ...patch,
    version: 1,
    provider: {
      ...(prev.provider ?? {}),
      ...(patch.provider ?? {}),
    },
    runtime: {
      ...(prev.runtime ?? {}),
      ...(patch.runtime ?? {}),
    },
    persona: {
      ...(prev.persona ?? {}),
      ...(patch.persona ?? {}),
      controls: {
        ...(prev.persona?.controls ?? {}),
        ...(patch.persona?.controls ?? {}),
      },
    },
    harness: {
      env: {
        ...(prev.harness?.env ?? {}),
        ...(patch.harness?.env ?? {}),
      },
    },
    updatedAt: Date.now(),
  };
}

