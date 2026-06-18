/**
 * Turn-level capability gates — activate verification tools, nudge missing steps,
 * and block premature turn-end when scenarios/user prompts require critics or verify.
 */
import type { RuntimePreferences } from "./runtime_prefs.js";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";

export const CRITIC_TOOL_NAMES = [
  "evidence_critic",
  "path_critic",
  "policy_critic",
] as const;

export const VERIFY_ORCHESTRATION_TOOL_NAMES = [
  "verify_result",
  ...CRITIC_TOOL_NAMES,
  "reflect_debate",
  "verify_contract",
] as const;

const REASONING_ONLY = new Set([
  "think",
  "reason",
  "plan",
  "hypothesize",
  "breakdown",
]);

/** Sub-agent verify/critic tools — on when explicitly enabled or critic gate is on. */
export function verifyToolsEnabled(prefs?: RuntimePreferences | null): boolean {
  if (resolveHarnessEnvRaw("AGENT_CRITIC_REQUIRE", prefs ?? null) === "1") return true;
  if (resolveHarnessEnvRaw("AGENT_CRITIC", prefs ?? null) === "1") return true;
  const explicit = resolveHarnessEnvRaw("AGENT_VERIFY_TOOLS", prefs ?? null)?.trim();
  if (explicit === "1") return true;
  if (explicit === "0") return false;
  return false;
}

export function criticGateEnabled(prefs?: RuntimePreferences | null): boolean {
  return (
    resolveHarnessEnvRaw("AGENT_CRITIC_REQUIRE", prefs ?? null) === "1" ||
    resolveHarnessEnvRaw("AGENT_CRITIC", prefs ?? null) === "1"
  );
}

export function criticMinTools(prefs?: RuntimePreferences | null): number {
  const raw = resolveHarnessEnvRaw("AGENT_CRITIC_MIN_TOOLS", prefs ?? null)?.trim();
  const n = raw ? parseInt(raw, 10) : 4;
  return Number.isFinite(n) ? Math.max(1, Math.min(32, n)) : 4;
}

export function userRequestsVerificationTools(userMessage: string): boolean {
  return /\b(verify_result|evidence_critic|path_critic|policy_critic|reflect_debate|verify_contract)\b/i.test(
    userMessage
  );
}

export function userRequestsCritics(userMessage: string): boolean {
  return /\b(evidence_critic|path_critic|policy_critic)\b/i.test(userMessage);
}

export function userRequestsOrderedSteps(userMessage: string): boolean {
  return (
    /\bstrictly follow this order\b/i.test(userMessage) ||
    /\bdo not skip any stage\b/i.test(userMessage) ||
    /\bthink\s*->\s*plan\b/i.test(userMessage) ||
    /\b\d+\)\s+Call\b/i.test(userMessage)
  );
}

export function userRequestsSymbolTools(userMessage: string): boolean {
  return /\bsymbol_index\b|\bfind_references\b|\bcode-ops\b/i.test(userMessage);
}

export function userRequestsVaultTools(userMessage: string): boolean {
  return /\bvault_write\b|\bvault_search\b|\bwiki knowledge\b/i.test(userMessage);
}

export function userRequestsSpawnOrchestration(userMessage: string): boolean {
  return /\bspawn_agent\b|\bwait_for_agents\b|\bdepends_on\b/i.test(userMessage);
}

/** Repo-relative paths the user named explicitly (for read_file grounding nudges). */
export function extractExplicitRepoPaths(userMessage: string): string[] {
  const matches =
    userMessage.match(
      /(?:packages|apps|scripts|docs)\/[\w./-]+\.(?:ts|tsx|js|jsx|json|md|mjs|cjs)/g
    ) ?? [];
  return [...new Set(matches.map((p) => p.replace(/\\/g, "/")))];
}

export function distillArtifactHashFromOutput(output: string): string | null {
  if (!output.includes("NEXT_ACTIONS_JSON")) return null;
  const jsonMatch = output.match(/NEXT_ACTIONS_JSON:\s*(\{[\s\S]*?\})(?:\n|$)/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]!) as {
        read_artifact?: { hash?: string };
      };
      const h = parsed.read_artifact?.hash?.trim();
      if (h) return h;
    } catch {
      /* fall through */
    }
  }
  const loose = output.match(/read_artifact[\s\S]{0,80}?hash["']?\s*[:=]\s*["']?([a-f0-9]{8,})/i);
  return loose?.[1] ?? "required";
}

export function buildDistillArtifactNudge(hash: string): string {
  if (hash === "required") {
    return (
      "[DISTILL HANDOFF] Tool output contains NEXT_ACTIONS_JSON pointing at read_artifact — " +
      "call read_artifact with the hash before summarizing or answering (R-DISTILL-ARTIFACT)."
    );
  }
  return (
    `[DISTILL HANDOFF] Distilled output archived full text — call read_artifact({ hash: "${hash}" }) ` +
    "before synthesizing (R-DISTILL-ARTIFACT)."
  );
}

export function buildOrderedStepsNudge(userMessage: string): string {
  return (
    "[ORDERED TASK] The user mandated a strict step sequence in this turn. " +
    "Execute stages in the stated order — one major stage per round when possible; do not batch plan+remember+read in one round out of order. " +
    "After file reads on cited paths, call verify_result when the sequence requires it (R-EXEC-ORDER, R-VERIFY-READ). " +
    `Sequence anchor: ${userMessage.slice(0, 280)}${userMessage.length > 280 ? "…" : ""}`
  );
}

export function buildExplicitPathReadNudge(paths: string[]): string {
  const list = paths.slice(0, 6).join(", ");
  return (
    "[PATH GROUNDING] The user named these repo paths — read_file each with ok:true before final synthesis: " +
    list +
    ". Use exact paths; for packages/* use repo root-relative paths (R-ANSWER-FIDELITY)."
  );
}

export function buildSymbolIndexNudge(): string {
  return (
    "[CODE LOCATE] This turn needs symbol_index — cwd must be the folder containing tsconfig.json " +
    "(e.g. packages/core, not packages/core/src). Then find_references if requested (R-CODE-LOCATE)."
  );
}

export function buildVaultToolsNudge(): string {
  return (
    "[VAULT TASK] vault_search before vault_write to reuse existing notes; vault tools are active. " +
    "Link related notes with [[wikilinks]] (R-VAULT-ENTITIES)."
  );
}

export function buildVerificationToolsNudge(missing: string[]): string {
  const list = missing.join(", ");
  return (
    "[VERIFICATION REQUIRED] User or harness settings require verification before this turn can end. " +
    "R-NO-END-VERIFY is suspended for explicitly requested critics/verify. " +
    `Call ${list} now — read_file cited paths first when checking file claims (R-VERIFY-READ). ` +
    "Then write the final user-visible answer."
  );
}

export function verificationToolsNeeded(
  userMessage: string,
  prefs?: RuntimePreferences | null
): boolean {
  return verifyToolsEnabled(prefs) || userRequestsVerificationTools(userMessage);
}

function actionToolCount(toolsUsed: string[]): number {
  return toolsUsed.filter((t) => !REASONING_ONLY.has(t)).length;
}

function missingVerificationTools(
  userMessage: string,
  toolsUsed: string[],
  prefs?: RuntimePreferences | null
): string[] {
  const used = new Set(toolsUsed);
  const missing: string[] = [];

  if (userRequestsCritics(userMessage)) {
    for (const c of CRITIC_TOOL_NAMES) {
      if (!used.has(c)) missing.push(c);
    }
    return missing;
  }

  if (/\bverify_result\b/i.test(userMessage) && !used.has("verify_result")) {
    missing.push("verify_result");
  }

  if (userRequestsOrderedSteps(userMessage)) {
    if (!used.has("verify_result")) missing.push("verify_result");
  }

  if (criticGateEnabled(prefs) && !used.has("verify_result")) {
    missing.push("verify_result");
  }

  return missing;
}

export function getMissingVerificationTools(
  userMessage: string,
  toolsUsed: string[],
  prefs?: RuntimePreferences | null
): string[] {
  return missingVerificationTools(userMessage, toolsUsed, prefs);
}

export interface VerificationContinuationInput {
  userMessage: string;
  toolsUsed: string[];
  prefs?: RuntimePreferences | null;
  gateAttempted: boolean;
}

/**
 * Block turn-end once when verification/critic tools were required but not invoked.
 */
export function needsVerificationContinuation(
  input: VerificationContinuationInput
): { needed: true; message: string; missing: string[] } | { needed: false } {
  if (input.gateAttempted) return { needed: false };
  if (!verificationToolsNeeded(input.userMessage, input.prefs)) return { needed: false };

  const explicit = userRequestsVerificationTools(input.userMessage);
  const gate = criticGateEnabled(input.prefs);
  if (!explicit && !gate) return { needed: false };

  const minTools = criticMinTools(input.prefs);
  if (!explicit && actionToolCount(input.toolsUsed) < minTools) {
    return { needed: false };
  }

  const missing = missingVerificationTools(input.userMessage, input.toolsUsed, input.prefs);
  if (missing.length === 0) return { needed: false };

  return {
    needed: true,
    missing,
    message: buildVerificationToolsNudge(missing),
  };
}

export function isCriticToolName(name: string): boolean {
  return (CRITIC_TOOL_NAMES as readonly string[]).includes(name) || name === "verify_result";
}
