/**
 * Session-start digest of recent harness failures (.agent_failures.jsonl).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { failureLogPath } from "./failure_log.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

const MS_7D = 7 * 86400 * 1000;

export async function formatFailureDigestForWorldContext(): Promise<string | null> {
  if (effectiveHarnessEnvRaw("AGENT_FAILURE_DIGEST") === "0") return null;
  const p = failureLogPath();
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n").filter(Boolean);
  const cutoff = Date.now() - MS_7D;
  const categories = new Map<string, number>();
  for (const line of lines) {
    try {
      const o = JSON.parse(line) as { t?: string; category?: string };
      const t = o.t ? Date.parse(o.t) : NaN;
      if (Number.isNaN(t) || t < cutoff) continue;
      const c = typeof o.category === "string" ? o.category : "unknown";
      categories.set(c, (categories.get(c) ?? 0) + 1);
    } catch {
      /* skip */
    }
  }
  if (categories.size === 0) return null;
  const top = [...categories.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c, n]) => `${c} (${n})`);
  return `Top failure categories (last 7d, from .agent_failures.jsonl): ${top.join("; ")} — avoid repeating these failure modes.`;
}
