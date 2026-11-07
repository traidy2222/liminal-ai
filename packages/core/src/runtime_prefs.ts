import {applyPersonaControlsToProfile} from "./runtime_persona_controls.js";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path, { join } from "node:path";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { HARNESS_SECRET_ENV_KEYS } from "./harness_env_inventory.js";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** JSON is untrusted at this boundary, even when its version is recognized. */
function validPreferences(value: unknown): value is RuntimePreferences {
  if (!isRecord(value) || value.version !== 1) return false;
  if (value.updatedAt !== undefined && (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt))) return false;
  for (const section of ["provider", "runtime", "harness", "persona"]) {
    if (value[section] !== undefined && !isRecord(value[section])) return false;
  }
  const provider = value.provider as Record<string, unknown> | undefined;
  for (const key of ["model", "baseURL"]) {
    if (provider?.[key] !== undefined && typeof provider[key] !== "string") return false;
  }
  const enums: Array<[unknown, readonly string[]]> = [
    [provider?.keySource, ["AGENT_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"]],
    [provider?.inferenceMode, ["byok", "managed", "auto"]],
  ];
  const runtime = value.runtime as Record<string, unknown> | undefined;
  enums.push([runtime?.uiVerbosity, ["normal", "quiet"]],
    [runtime?.vaultAutoWriteMode, ["off", "research", "aggressive"]],
    [runtime?.destructiveGate, ["strict", "balanced"]]);
  if (enums.some(([item, allowed]) => item !== undefined && (typeof item !== "string" || !allowed.includes(item)))) return false;
  for (const key of ["approvalTimeoutMs", "rateLimitMaxRetries", "transient5xxMaxRetries", "retryMaxDelayMs"]) {
    const number = runtime?.[key];
    if (number !== undefined && (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0)) return false;
  }
  const env = (value.harness as Record<string, unknown> | undefined)?.env;
  return env === undefined || (isRecord(env) && Object.values(env).every(item => typeof item === "string"));
}

function withoutPersistedSecrets(prefs: RuntimePreferences): RuntimePreferences {
  const env = prefs.harness?.env;
  if (!env || typeof env !== "object" || !Object.keys(env).some(key => HARNESS_SECRET_ENV_KEYS.has(key))) return prefs;
  const clean = { ...env };
  for (const key of HARNESS_SECRET_ENV_KEYS) delete clean[key];
  return { ...prefs, harness: { ...prefs.harness, env: clean } };
}

const preferenceOperations = new Map<string, Promise<unknown>>();
async function withPreferenceFile<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(filePath);
  const previous = preferenceOperations.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  preferenceOperations.set(key, pending);
  try { return await pending; }
  finally { if (preferenceOperations.get(key) === pending) preferenceOperations.delete(key); }
}

async function writePreferencesFile(filePath: string, prefs: RuntimePreferences): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(prefs, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, filePath); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") || attempt >= 6) throw error;
        // Windows readers/virus scanners can briefly hold the destination open.
        await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
      }
    }
  } finally { await rm(temporary, { force: true }); }
}

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
  return withPreferenceFile(filePath, async () => {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (validPreferences(parsed)) {
      const clean = withoutPersistedSecrets(parsed);
      if (clean !== parsed) {
        try { await writePreferencesFile(filePath, clean); }
        catch { /* Read-only storage must not hide valid, sanitized settings. */ }
      }
      return clean;
    }
    return null;
  } catch {
    return null;
  }
  });
}

export async function saveRuntimePreferences(
  prefs: RuntimePreferences,
  workspaceRoot?: string
): Promise<string> {
  if (!validPreferences(prefs)) throw new Error("Invalid runtime preferences");
  await ensureGlobalStorageRoot();
  const filePath = await pickWritePath(runtimePrefsPaths(workspaceRoot));
  await mkdir(path.dirname(filePath), { recursive: true });
  await withPreferenceFile(filePath, () => writePreferencesFile(filePath, withoutPersistedSecrets(prefs)));
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



/** Merge sparse harness changes against current disk state under the file queue. */
export async function patchSavedRuntimePreferences(patch:Partial<RuntimePreferences>,workspaceRoot?:string):Promise<{preferences:RuntimePreferences;filePath:string}>{
 await ensureGlobalStorageRoot();
 const filePath=await pickWritePath(runtimePrefsPaths(workspaceRoot));
 await mkdir(path.dirname(filePath),{recursive:true});
 return withPreferenceFile(filePath,async()=>{
  let current:RuntimePreferences|null=null;
  try{const parsed=JSON.parse(await readFile(filePath,'utf8'));if(!validPreferences(parsed))throw new Error('Existing runtime preferences are invalid');current=withoutPersistedSecrets(parsed);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const preferences=withoutPersistedSecrets(mergeRuntimePreferences(current,patch));
  if(patch.persona?.controls&&!patch.persona.activeProfile&&preferences.persona?.activeProfile){
   preferences.persona.activeProfile=applyPersonaControlsToProfile(preferences.persona.activeProfile,patch.persona.controls);
  }
  if(!validPreferences(preferences))throw new Error("Invalid runtime preference patch");
  await writePreferencesFile(filePath,preferences);return {preferences,filePath};
 });
}
