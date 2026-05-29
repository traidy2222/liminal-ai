/**
 * Memory curator — pure planning + guardrails for LLM-driven note pruning.
 *
 * Where `auto_dream` (auto_dream.ts) consolidates *session traces* into new
 * memories, the curator looks at the *note store itself* and decides what to
 * prune, merge, or downgrade. The decision is the LLM's (see
 * `buildCuratorPrompt`); this module only builds the prompt, parses the reply,
 * and applies a deterministic SAFETY-RAIL veto so a hallucinated delete can
 * never remove a durable identity fact.
 *
 * Pure functions only — no fs / network / tools import — so both the
 * `curate_memory` tool (tools package) and the background `auto_dream` delete
 * path (agent.ts) can share the exact same guardrails without a circular
 * dependency. Mirrors the shape of auto_dream.ts (prompt builder + helpers).
 */

import { spacedRepetitionDecay } from "./memory_rank.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

/** A note handed to the curator for review, with the metadata the LLM reasons over. */
export interface CuratorNote {
  key: string;
  value: string;
  type?: string;
  createdAt?: string;
  updatedAt?: string;
  lastAccessedAt?: string;
  accessCount?: number;
  confidence?: number;
  scope?: "chat" | "workspace" | "global";
}

export interface CuratorPrune {
  key: string;
  reason: string;
}
export interface CuratorMerge {
  keep: string;
  drop: string[];
  mergedValue: string;
  reason: string;
}
export interface CuratorAdjust {
  key: string;
  confidence: number;
  reason: string;
}

export interface CuratorPlan {
  summary: string;
  prune: CuratorPrune[];
  merge: CuratorMerge[];
  adjust: CuratorAdjust[];
}

/** Thresholds for the deterministic guardrail. Env-overridable; sane defaults. */
export interface CuratorSafetyOpts {
  /** Notes accessed at least this many times are never pruned/dropped. */
  protectAccessCount: number;
  /** Notes younger than this (hours, by createdAt) are never pruned/dropped. */
  protectMinAgeHours: number;
  /** Override "now" for deterministic tests. */
  nowMs?: number;
}

export interface VetoedItem {
  key: string;
  rule: string;
}

/** Resolve the safety thresholds from env, falling back to the documented defaults. */
export function resolveCuratorSafetyOpts(): CuratorSafetyOpts {
  const accRaw = parseInt(effectiveHarnessEnvRaw("AGENT_CURATOR_PROTECT_ACCESS_COUNT")?.trim() ?? "", 10);
  const ageRaw = parseInt(effectiveHarnessEnvRaw("AGENT_CURATOR_PROTECT_MIN_AGE_HOURS")?.trim() ?? "", 10);
  return {
    protectAccessCount: Number.isFinite(accRaw) ? Math.max(0, accRaw) : 3,
    protectMinAgeHours: Number.isFinite(ageRaw) ? Math.max(0, ageRaw) : 24,
  };
}

/** Key prefixes that mark durable identity facts the curator must never remove. */
const PROTECTED_PREFIXES = ["user", "identity", "pref"];

function keyPrefix(key: string): string {
  const colon = key.indexOf(":");
  return colon > 0 ? key.slice(0, colon).toLowerCase() : "";
}

/**
 * Return a protection rule string if this note must NOT be pruned/dropped, else
 * null. Centralizes the veto policy so prune + merge-drop share it exactly.
 */
export function protectionRuleFor(note: CuratorNote | undefined, opts: CuratorSafetyOpts): string | null {
  if (!note) return null; // unknown key — nothing to protect (handled as no-op by caller)
  if (note.scope === "global") return "scope=global";
  if (PROTECTED_PREFIXES.includes(keyPrefix(note.key))) return `protected-prefix:${keyPrefix(note.key)}`;
  if ((note.accessCount ?? 0) >= opts.protectAccessCount) return `accessCount>=${opts.protectAccessCount}`;
  const created = note.createdAt ? new Date(note.createdAt).getTime() : NaN;
  if (Number.isFinite(created)) {
    const ageHours = ((opts.nowMs ?? Date.now()) - created) / 3_600_000;
    if (ageHours < opts.protectMinAgeHours) return `age<${opts.protectMinAgeHours}h`;
  }
  return null;
}

/**
 * Apply the deterministic guardrail over an LLM-produced plan. Removes any
 * prune whose target is protected, strips protected keys out of merge-drop
 * lists (dropping the whole merge if no drops survive), and leaves `adjust`
 * untouched (changing confidence is non-destructive). Returns the vetted plan
 * plus an audit list of what was vetoed and why.
 */
export function applyCuratorSafetyRails(
  plan: CuratorPlan,
  notesByKey: Map<string, CuratorNote>,
  opts: CuratorSafetyOpts
): { plan: CuratorPlan; vetoed: VetoedItem[] } {
  const vetoed: VetoedItem[] = [];

  const prune = plan.prune.filter((p) => {
    const rule = protectionRuleFor(notesByKey.get(p.key), opts);
    if (rule) {
      vetoed.push({ key: p.key, rule });
      return false;
    }
    return true;
  });

  const merge: CuratorMerge[] = [];
  for (const m of plan.merge) {
    const survivingDrops = m.drop.filter((d) => {
      // Never let a merge silently delete the keep target or a protected note.
      if (d === m.keep) return false;
      const rule = protectionRuleFor(notesByKey.get(d), opts);
      if (rule) {
        vetoed.push({ key: d, rule: `merge-drop:${rule}` });
        return false;
      }
      return true;
    });
    if (survivingDrops.length > 0) merge.push({ ...m, drop: survivingDrops });
  }

  return { plan: { ...plan, prune, merge }, vetoed };
}

/**
 * When the store is larger than `max`, pick which notes the LLM reviews. Orders
 * by ascending spaced-repetition decay (least-useful first) so prune candidates
 * are always in view; high-value notes are implicitly kept by not being shown.
 * This is SELECTION ONLY — the keep/prune decision is still the LLM's.
 */
export function selectReviewSlice(notes: CuratorNote[], max: number, nowMs?: number): CuratorNote[] {
  if (notes.length <= max) return notes;
  const now = nowMs ?? Date.now();
  return [...notes]
    .map((n) => ({
      n,
      decay: spacedRepetitionDecay({
        lastAccessedAt: n.lastAccessedAt,
        accessCount: n.accessCount,
        confidence: n.confidence,
        nowMs: now,
      }),
    }))
    .sort((a, b) => a.decay - b.decay)
    .slice(0, max)
    .map((x) => x.n);
}

function ageDays(iso: string | undefined, nowMs: number): string {
  if (!iso) return "?";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "?";
  return Math.max(0, Math.round((nowMs - t) / 86_400_000)).toString();
}

/**
 * Build the strict-JSON curation prompt. Each note is rendered with the
 * metadata the model should weigh; values are truncated to keep the prompt
 * bounded. The model returns prune / merge / adjust operations only.
 */
export function buildCuratorPrompt(notes: CuratorNote[], nowMs?: number): string {
  const now = nowMs ?? Date.now();
  const rows = notes
    .map((n) => {
      const meta = [
        `type=${n.type ?? "general"}`,
        `ageDays=${ageDays(n.createdAt, now)}`,
        `lastAccessDays=${ageDays(n.lastAccessedAt, now)}`,
        `access=${n.accessCount ?? 0}`,
        `conf=${(n.confidence ?? 0.5).toFixed(2)}`,
        `scope=${n.scope ?? "?"}`,
      ].join(" ");
      return `- [${n.key}] (${meta})\n  ${n.value.replace(/\s+/g, " ").slice(0, 240)}`;
    })
    .join("\n");

  return (
    "You are a memory curator for a long-running AI agent's note store.\n" +
    "Review the notes below and return JSON ONLY (no markdown fences, no prose outside JSON).\n\n" +
    "Output schema:\n" +
    "{\n" +
    '  "summary": "one-line plain-language summary of what you changed and why",\n' +
    '  "prune": [{"key":"exact_key","reason":"why it is safe to remove"}],\n' +
    '  "merge": [{"keep":"exact_key","drop":["exact_key",...],"mergedValue":"combined text","reason":"..."}],\n' +
    '  "adjust": [{"key":"exact_key","confidence":0.0,"reason":"why trust changed"}]\n' +
    "}\n\n" +
    "Rules:\n" +
    "- PRUNE only notes that are clearly stale, superseded, duplicated elsewhere, never accessed and low-value, or obvious tool noise.\n" +
    "- MERGE near-duplicates: keep the richer/more-recent key, fold the rest into mergedValue, list the others under drop.\n" +
    "- ADJUST confidence down for facts that look shaky or unverified; up for ones repeatedly useful.\n" +
    "- NEVER prune durable identity/preference facts (keys like user:*, identity:*, pref:*) or high-access notes — the harness vetoes these anyway, so don't waste operations on them.\n" +
    "- Use exact keys verbatim from the list. Be conservative: when unsure, keep.\n\n" +
    "Notes:\n" +
    rows
  );
}

/** Defensive parse + shape-validate an LLM curation reply. Returns null on junk. */
export function parseCuratorPlan(raw: unknown): CuratorPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const prune: CuratorPrune[] = Array.isArray(obj["prune"])
    ? (obj["prune"] as unknown[])
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .filter((p) => typeof p["key"] === "string" && (p["key"] as string).trim().length > 0)
        .map((p) => ({ key: (p["key"] as string).trim(), reason: String(p["reason"] ?? "").slice(0, 240) }))
    : [];

  const merge: CuratorMerge[] = Array.isArray(obj["merge"])
    ? (obj["merge"] as unknown[])
        .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
        .filter(
          (m) =>
            typeof m["keep"] === "string" &&
            typeof m["mergedValue"] === "string" &&
            Array.isArray(m["drop"])
        )
        .map((m) => ({
          keep: (m["keep"] as string).trim(),
          drop: (m["drop"] as unknown[]).filter((d): d is string => typeof d === "string" && d.trim().length > 0).map((d) => d.trim()),
          mergedValue: (m["mergedValue"] as string).slice(0, 4000),
          reason: String(m["reason"] ?? "").slice(0, 240),
        }))
        .filter((m) => m.drop.length > 0)
    : [];

  const adjust: CuratorAdjust[] = Array.isArray(obj["adjust"])
    ? (obj["adjust"] as unknown[])
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
        .filter((a) => typeof a["key"] === "string" && typeof a["confidence"] === "number")
        .map((a) => ({
          key: (a["key"] as string).trim(),
          confidence: Math.max(0, Math.min(1, a["confidence"] as number)),
          reason: String(a["reason"] ?? "").slice(0, 240),
        }))
    : [];

  const summary = typeof obj["summary"] === "string" ? (obj["summary"] as string).trim().slice(0, 400) : "";
  return { summary, prune, merge, adjust };
}
