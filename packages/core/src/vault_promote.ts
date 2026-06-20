/**
 * Promote JSON memory consolidation upserts into vault tools (vault-primary brain).
 * Lives in core — calls tools only via dispatcher directCall.
 */
import type { ToolResult } from "./types.js";

export interface ConsolidationUpsert {
  type?: string;
  key?: string;
  value?: string;
}

type DirectCall = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

const VAULT_TYPES = new Set(["entity", "fact", "experience", "belief"]);

function titleFromKey(key: string): string {
  const k = key.trim().replace(/[_-]+/g, " ");
  if (!k) return "Untitled";
  return k.charAt(0).toUpperCase() + k.slice(1);
}

export async function promoteConsolidationUpsertsToVault(
  directCall: DirectCall,
  upserts: ConsolidationUpsert[],
  opts?: { hasIngestEntities?: boolean; hasIngest?: boolean }
): Promise<{ promoted: number; errors: string[] }> {
  const hasIngest = opts?.hasIngest ?? true;
  const hasEntities = opts?.hasIngestEntities ?? true;
  let promoted = 0;
  const errors: string[] = [];
  const entityBlob: string[] = [];

  for (const u of upserts) {
    const typ = (u.type ?? "fact").trim().toLowerCase();
    const key = (u.key ?? "").trim();
    const value = (u.value ?? "").trim();
    if (!key || value.length < 12) continue;
    if (!VAULT_TYPES.has(typ)) continue;

    if (typ === "entity" && value.length >= 80 && hasEntities) {
      entityBlob.push(`## ${titleFromKey(key)}\n${value}`);
      continue;
    }
    if (!hasIngest) continue;
    const title = titleFromKey(key);
    const noteType = typ === "entity" ? "entity" : typ === "belief" ? "reflection" : "fact";
    const body =
      noteType === "entity"
        ? `## Identity\n${title}\n\n## Current\n${value}\n`
        : `## Summary\n${value}\n`;
    const r = await directCall("vault_ingest", {
      title,
      content: body,
      type: noteType,
      tags: ["liminal-agent", "consolidation", typ],
      summary: value.slice(0, 160),
    });
    if (r.ok) promoted++;
    else errors.push(`${key}: ${r.error ?? "vault_ingest failed"}`);
  }

  if (entityBlob.length > 0 && hasEntities) {
    const r = await directCall("vault_ingest_entities", {
      content: entityBlob.join("\n\n"),
      source: "Memory consolidation",
      max_entities: Math.min(16, entityBlob.length + 4),
    });
    if (r.ok) promoted += entityBlob.length;
    else errors.push(`entities batch: ${r.error ?? "vault_ingest_entities failed"}`);
  }

  return { promoted, errors };
}
