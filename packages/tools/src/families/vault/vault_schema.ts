/**
 * Living vault schema — Karpathy wiki conventions maintained in the vault.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import { resolveSpinePath } from "./vault_ingest_core.js";
import { resolveVaultAgentPrefix, LIMINAL_AGENT_TAG } from "./vault_agent_zone.js";

export function buildVaultSchemaMarkdown(): string {
  const prefix = resolveVaultAgentPrefix();
  return [
    "# Liminal vault schema",
    "",
    "Agent-maintained wiki conventions (Karpathy LLM-Wiki pattern). Human notes outside the safe zone are read-only for the agent.",
    "",
    "## Layers",
    "",
    `- **raw/** — immutable ingested sources under \`${prefix}/raw/\``,
    "- **wiki** — cross-linked markdown dossiers (Entities, Concepts, Sources, Synthesis, MOCs)",
    "- **schema** — this file (conventions + lint rules)",
    "",
    "## Page types",
    "",
    "| type | purpose |",
    "|------|---------|",
    "| entity | Person/org/place dossier (## Identity / ## Current / ## History / ## Relationships) |",
    "| concept | Atomic idea, doctrine, system, or program |",
    "| episode | War, revolution, treaty, or other temporal event |",
    "| source | Pointer/summary of a raw item |",
    "| synthesis | Evolving topic summary |",
    "| moc | Map-of-content hub listing member pages |",
    "| fact | Short durable claim |",
    "| note | General wiki page |",
    "",
    "## Write rules (agent)",
    "",
    `- Tag agent writes with \`${LIMINAL_AGENT_TAG}\` or place under \`${prefix}/\``,
    "- Prefer **vault_ingest** / **vault_ingest_entities** / **vault_ingest_source** — not orphan **vault_write** blobs",
    "- Every ingest must gain ≥1 real [[wikilink]] (bidirectional weave adds inbound links on neighbors)",
    "- One canonical proper name = one entity dossier",
    "- Sources: link wiki pages to `[[raw/…]]` under ## Sources",
    "",
    "## Query rules",
    "",
    "- Start from index.md + vault_recall neighborhood — not whole-vault RAG",
    "- vault_search before writing to dedupe",
    "",
    "## Lint rules",
    "",
    "- Orphan = no inbound backlinks — run vault_lint fix:true on agent zone",
    "- Near-duplicates: merge or add [!contradiction] callout",
    "",
  ].join("\n");
}

export async function ensureVaultSchemaFile(force = false): Promise<{ path: string; updated: boolean }> {
  const fp = resolveSpinePath("schema.md");
  await mkdir(join(fp, ".."), { recursive: true });
  const body = buildVaultSchemaMarkdown();
  if (!force) {
    try {
      const existing = await readFile(fp, "utf8");
      if (existing.trim() === body.trim()) return { path: fp, updated: false };
    } catch {
      /* write */
    }
  }
  await writeFile(fp, body, "utf8");
  return { path: fp, updated: true };
}

/** Short summary for world context injection. */
export function vaultSchemaContextBlurb(): string {
  const prefix = resolveVaultAgentPrefix();
  const requireLinks = effectiveHarnessEnvRaw("AGENT_VAULT_REQUIRE_LINKS") !== "0";
  return (
    `Vault schema: agent zone \`${prefix}/\` + tag \`${LIMINAL_AGENT_TAG}\`; ` +
    `types entity|concept|source|synthesis|moc; ingest>write; require_links=${requireLinks ? "on" : "off"}.`
  );
}
