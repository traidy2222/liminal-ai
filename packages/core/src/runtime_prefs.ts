import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "./workspace_root.js";

export type ProviderKeySource =
  | "AGENT_API_KEY"
  | "OPENROUTER_API_KEY"
  | "OPENAI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "XAI_API_KEY";

export interface RuntimePersonaSpeechStyle {
  sentenceStructure: string;
  formality: "very_formal" | "formal" | "casual" | "very_casual" | "mixed";
  favoriteWords: string[];
  avoidWords: string[];
  commonMetaphors: string[];
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
  catchphrases: string[];
  verbalTics: string[];
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

export interface RuntimePreferences {
  version: 1;
  provider?: {
    model?: string;
    baseURL?: string;
    keySource?: ProviderKeySource;
  };
  runtime?: {
    uiVerbosity?: "normal" | "quiet";
    vaultAutoWriteMode?: "off" | "research" | "aggressive";
    vaultFirstStrict?: boolean;
    approvalTimeoutMs?: number;
    destructiveGate?: "strict" | "balanced";
    rateLimitMaxRetries?: number;
    transient5xxMaxRetries?: number;
    retryMaxDelayMs?: number;
  };
  persona?: RuntimePersonaPreferences;
  updatedAt: number;
}

export const RUNTIME_PREFS_FILE = ".agent_runtime_prefs.json";

export function getRuntimePrefsPath(workspaceRoot?: string): string {
  const root = workspaceRoot ? workspaceRoot : resolveWorkspaceRoot();
  return join(root, RUNTIME_PREFS_FILE);
}

export async function loadRuntimePreferences(
  workspaceRoot?: string
): Promise<RuntimePreferences | null> {
  const path = getRuntimePrefsPath(workspaceRoot);
  try {
    const raw = await readFile(path, "utf8");
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
  const path = getRuntimePrefsPath(workspaceRoot);
  await writeFile(path, JSON.stringify(prefs, null, 2), "utf8");
  return path;
}

