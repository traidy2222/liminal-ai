/**
 * Lightweight tool-output fact extractor.
 *
 * After each successful tool result, runs regex patterns to pull out high-value
 * facts (file paths, URLs, ports, counts, entity names) and publishes them to
 * the SharedMemoryBus so sub-agents and siblings receive them without explicit
 * memory calls.
 *
 * Gate: AGENT_FACT_EXTRACT=1
 */

import type { SharedMemoryBus } from "./shared_memory_bus.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export interface ExtractedFact {
  kind: "path" | "url" | "port" | "count" | "entity" | "key_value";
  value: string;
  rawKey: string;
}

const FILE_PATH_RE = /(?:^|[\s"'`(])([A-Za-z]:[\\/][\w\\/.\-]+\.\w{1,10}|\/[\w/.\-]+\.\w{1,10}|(?:[\w.\-]+\/)+[\w.\-]+\.\w{1,10})/gm;
const URL_RE = /https?:\/\/[^\s"'<>)]{8,}/g;
const PORT_RE = /(?:port|PORT|:)[\s:=]?(\d{2,5})\b/g;
const COUNT_RE = /\b(\d{1,9})\s+(?:file|line|result|match|record|row|item|entry|error|warning)s?\b/gi;
const KEY_VALUE_RE = /\b([A-Z_]{3,40})=([^\s"']{1,120})/g;
const ENTITY_RE = /(?:name|title|label|slug|id)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-. ]{2,80})["']?/gi;

function isFactExtractEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_FACT_EXTRACT") === "1";
}

function dedup<T>(arr: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Pure fact extraction — no env gate. Used by context compression to preserve
 * hard facts (paths, URLs, ports, counts) when old tool rounds are summarized.
 */
export function extractFactsRaw(toolName: string, output: string): ExtractedFact[] {
  const text = output.slice(0, 8000); // cap to avoid O(n²) on huge outputs
  const facts: ExtractedFact[] = [];

  // File paths
  for (const m of text.matchAll(FILE_PATH_RE)) {
    const v = m[1]?.trim();
    if (v && v.length >= 4) {
      facts.push({ kind: "path", value: v, rawKey: `path:${toolName}:${v}` });
    }
  }

  // URLs
  for (const m of text.matchAll(URL_RE)) {
    const v = m[0].replace(/[),.'";]+$/, "").trim();
    if (v.length >= 12) {
      facts.push({ kind: "url", value: v, rawKey: `url:${toolName}:${v}` });
    }
  }

  // Ports
  for (const m of text.matchAll(PORT_RE)) {
    const n = parseInt(m[1] ?? "0", 10);
    if (n >= 1 && n <= 65535) {
      facts.push({ kind: "port", value: String(n), rawKey: `port:${toolName}:${n}` });
    }
  }

  // Counts
  for (const m of text.matchAll(COUNT_RE)) {
    const v = m[0].trim();
    facts.push({ kind: "count", value: v, rawKey: `count:${toolName}:${v}` });
  }

  // Key=value env-style pairs (limit to 12 per tool)
  let kvCount = 0;
  for (const m of text.matchAll(KEY_VALUE_RE)) {
    if (kvCount++ >= 12) break;
    const k = m[1]?.trim();
    const v = m[2]?.trim();
    if (k && v) {
      facts.push({ kind: "key_value", value: `${k}=${v}`, rawKey: `kv:${toolName}:${k}` });
    }
  }

  // Named entities (limit to 8)
  let entCount = 0;
  for (const m of text.matchAll(ENTITY_RE)) {
    if (entCount++ >= 8) break;
    const v = m[1]?.trim();
    if (v && v.length >= 2) {
      facts.push({ kind: "entity", value: v, rawKey: `entity:${toolName}:${v}` });
    }
  }

  return dedup(facts, (f) => f.rawKey);
}

/** Env-gated extraction (AGENT_FACT_EXTRACT=1) — used for live bus publishing. */
export function extractFacts(toolName: string, output: string): ExtractedFact[] {
  if (!isFactExtractEnabled()) return [];
  return extractFactsRaw(toolName, output);
}

/**
 * Extract facts from a tool result and publish them to the shared bus.
 * No-op when AGENT_FACT_EXTRACT is not "1".
 */
export function publishToolFacts(
  bus: SharedMemoryBus,
  publisherId: string,
  toolName: string,
  output: string
): void {
  const facts = extractFacts(toolName, output);
  for (const fact of facts) {
    try {
      bus.publish(fact.rawKey, fact.value, publisherId);
    } catch {
      // bus errors are non-fatal
    }
  }
}

/**
 * Read all facts of a given kind published to the bus.
 */
export function readBusFacts(
  bus: SharedMemoryBus,
  kind: ExtractedFact["kind"]
): Array<{ key: string; value: string }> {
  const prefix = `${kind}:`;
  const all = bus.getAll();
  return Object.entries(all)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ key: k, value: v }));
}
