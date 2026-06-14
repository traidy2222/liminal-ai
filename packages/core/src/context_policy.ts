import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";
import type { ModelContextLimits } from "./model_context_registry.js";

export type ContextPolicyTier = "small" | "medium" | "large" | "xlarge";

export type ContextPolicy = {
  tier: ContextPolicyTier;
  contextLength: number;
  maxCompletionTokens?: number;
  thresholdFraction: number;
  hotRounds: number;
  warmRounds: number;
  elideMinChars: number;
  preflightPasses: number;
};

function tierForContextLength(contextLength: number): ContextPolicyTier {
  if (contextLength >= 500_000) return "xlarge";
  if (contextLength >= 200_000) return "large";
  if (contextLength >= 128_000) return "medium";
  return "small";
}

const TIER_DEFAULTS: Record<
  ContextPolicyTier,
  Omit<ContextPolicy, "tier" | "contextLength" | "maxCompletionTokens">
> = {
  small: {
    thresholdFraction: 0.5,
    hotRounds: 2,
    warmRounds: 4,
    elideMinChars: 4000,
    preflightPasses: 6,
  },
  medium: {
    thresholdFraction: 0.55,
    hotRounds: 3,
    warmRounds: 6,
    elideMinChars: 6000,
    preflightPasses: 4,
  },
  large: {
    thresholdFraction: 0.6,
    hotRounds: 4,
    warmRounds: 8,
    elideMinChars: 8000,
    preflightPasses: 4,
  },
  xlarge: {
    thresholdFraction: 0.65,
    hotRounds: 6,
    warmRounds: 12,
    elideMinChars: 12_000,
    preflightPasses: 3,
  },
};

function envInt(
  key: keyof typeof HARNESS_ENV_DEFAULTS & string,
  fallback: number,
  min: number,
  max: number
): number {
  const effective = effectiveHarnessEnvRaw(key)?.trim();
  const typedDefault = String(HARNESS_ENV_DEFAULTS[key] ?? "");
  if (!effective || effective === typedDefault) return fallback;
  const n = parseInt(effective, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function envIntOpt(key: string, fallback: number, min: number, max: number): number {
  const effective = effectiveHarnessEnvRaw(key)?.trim();
  if (!effective) return fallback;
  const n = parseInt(effective, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function envFraction(key: string, fallback: number): number {
  const effective = effectiveHarnessEnvRaw(key)?.trim();
  if (!effective) return fallback;
  const n = parseFloat(effective);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return fallback;
  return n;
}

/** Derive compression / elision knobs from resolved model context limits. */
export function buildContextPolicy(limits: ModelContextLimits): ContextPolicy {
  const tier = tierForContextLength(limits.contextLength);
  const defaults = TIER_DEFAULTS[tier];
  return {
    tier,
    contextLength: limits.contextLength,
    maxCompletionTokens: limits.maxCompletionTokens,
    thresholdFraction: envFraction("AGENT_CTX_THRESHOLD", defaults.thresholdFraction),
    hotRounds: envInt("AGENT_CTX_HOT_ROUNDS", defaults.hotRounds, 2, 32),
    warmRounds: envInt("AGENT_CTX_WARM_ROUNDS", defaults.warmRounds, 0, 64),
    elideMinChars: envIntOpt("AGENT_CTX_ELIDE_MIN_CHARS", defaults.elideMinChars, 1000, 50_000),
    preflightPasses: defaults.preflightPasses,
  };
}
