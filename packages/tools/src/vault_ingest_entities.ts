/**
 * vault_ingest_entities — decompose content into a knowledge graph of entity notes.
 *
 * Instead of one big note, this extracts the people / orgs / places / events /
 * concepts in the content and gives each its own atomic dossier note (Identity /
 * Current / History / Relationships), MERGING into an existing note when the
 * entity is already known (so pages accrete over time) and cross-linking
 * entities to each other. Optionally writes a thin hub note that links them all.
 *
 * This is the "real brain" write path (GraphRAG / Karpathy entity pages); pair
 * with vault_recall to read the connected neighborhood back.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineTool } from "./helpers.js";
import {
  writeVaultNote,
  findNote,
  getVaultDir,
  type NoteType,
} from "./vault_store.js";
import { upsertVaultEmbeddings } from "./vault_index.js";
import { resolveEmbedCreds } from "./vault_embed.js";
import { appendLogLine, upsertIndexEntry } from "./vault_nexus.js";
import { extractEntities } from "./vault_entity_extract.js";
import { mergeEntity, entityNoteTypeFor, type ExtractedEntity } from "./vault_entity_merge.js";

async function updateSpineFile(fileName: string, transform: (cur: string) => string): Promise<void> {
  const fp = join(getVaultDir(), fileName);
  let existing = "";
  try {
    existing = await readFile(fp, "utf8");
  } catch {
    /* new */
  }
  await writeFile(fp, transform(existing), "utf8");
}

export const vaultIngestEntitiesTool = defineTool({
  name: "vault_ingest_entities",
  description:
    "WHAT: Turn content into a knowledge GRAPH — one atomic note per entity (person, org/business, place, event, concept).\n" +
    "NEVER put multiple entities in one note. Each gets a dossier (Identity / Current / History / Relationships) and MERGES\n" +
    "into an existing note when the canonical name already exists.\n" +
    "WHEN: User asks for entities connected to an event; cast lists; research naming multiple parties; any multi-entity intel.\n" +
    "Use when you have combined research text to split — NOT when you already have one finished dossier (use vault_write).\n" +
    "Event+cast: extracts event + each participant as separate notes with Relationships.\n" +
    "Alternative: parallel vault_write calls with the standard entity template (often clearer when bios are ready).\n" +
    "ARGS: content — raw text to decompose; source — topic label (hub note when 2+ entities); max_entities (default 12); hub_title optional.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "Text to decompose into entity notes" },
      source: {
        type: "string",
        description: "Optional source label — when set, writes a hub note linking all extracted entities",
      },
      hub_title: { type: "string", description: "Optional explicit title for the hub note" },
      max_entities: { type: "number", minimum: 1, maximum: 24, description: "Max entities (default 12)" },
    },
    required: ["content"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    try {
      const content = String(args["content"] ?? "");
      if (content.trim().length < 40) {
        return { ok: false, error: "vault_ingest_entities needs more content to extract entities from." };
      }
      const maxEntities = Math.max(1, Math.min(24, (args["max_entities"] as number | undefined) ?? 12));
      emit?.(`\nvault_ingest_entities: extracting entities…\n`);

      const extracted = await extractEntities(content, { maxEntities });
      const entities = extracted.entities;
      if (entities.length === 0) {
        return {
          ok: false,
          error:
            extracted.error ??
            "No entities extracted. For one entity dossier use vault_write/vault_ingest with title = canonical name and body ## Identity / ## Current / ## Relationships.",
        };
      }

      const creds = await resolveEmbedCreds();
      const date = new Date().toISOString().slice(0, 10);
      const created: string[] = [];
      const updated: string[] = [];
      const embedBatch: Array<{ slug: string; title: string; type: string; body: string }> = [];

      for (const e of entities as ExtractedEntity[]) {
        const title = e.name;
        const existing = await findNote(title);
        const { body } = mergeEntity(existing?.body ?? null, e, date);
        const type = entityNoteTypeFor(e.kind) as NoteType;
        const tags = ["entity", e.kind];
        const { slug } = await writeVaultNote({ title, body, type, tags });
        embedBatch.push({ slug, title, type, body });
        (existing ? updated : created).push(title);
        emit?.(`  ${existing ? "↻" : "+"} [[${title}]] (${e.kind}, ${e.relationships?.length ?? 0} links)\n`);

        // Spine upkeep per entity.
        try {
          await updateSpineFile("index.md", (cur) =>
            upsertIndexEntry(cur, { title, type, summary: e.summary || e.current || "" })
          );
        } catch {
          /* non-fatal */
        }
      }

      // Thin hub note linking the cluster (auto when 2+ entities or source/hub_title set).
      const eventRow = entities.find((e) => e.kind === "event");
      const hubTitle =
        (args["hub_title"] as string | undefined)?.trim() ||
        (args["source"] ? `${String(args["source"]).trim()} (${date})` : "") ||
        (entities.length >= 2 && eventRow ? `${eventRow.name} — entities` : "") ||
        (entities.length >= 2 ? `Entity cluster (${date})` : "");
      if (hubTitle) {
        const hubBody =
          `## Overview\nIndex of related entity dossiers (${date}). Each party has its own note — details live there, not here.\n\n` +
          `## Entities\n${entities.map((e) => `- [[${e.name}]] — ${e.kind}${e.summary ? `: ${e.summary.slice(0, 80)}` : ""}`).join("\n")}`;
        try {
          const { slug } = await writeVaultNote({
            title: hubTitle,
            body: hubBody,
            type: "note",
            tags: ["hub", "auto-wiki"],
          });
          embedBatch.push({ slug, title: hubTitle, type: "note", body: hubBody });
          emit?.(`  ⊕ hub: [[${hubTitle}]]\n`);
        } catch {
          /* non-fatal */
        }
      }

      // Embedding index (batch) + timeline.
      if (creds && embedBatch.length) {
        try {
          await upsertVaultEmbeddings({
            apiKey: creds.apiKey,
            baseURL: creds.baseURL,
            model: creds.model,
            notes: embedBatch,
          });
        } catch {
          /* non-fatal */
        }
      }
      try {
        await updateSpineFile("log.md", (cur) =>
          appendLogLine(cur, {
            date,
            action: "ingest-entities",
            title: `${created.length + updated.length} entities`,
          })
        );
      } catch {
        /* non-fatal */
      }

      emit?.(`  ✓ ${created.length} new, ${updated.length} updated\n`);
      const fmt = (xs: string[]) => xs.map((t) => `[[${t}]]`).join(", ") || "—";
      return {
        ok: true,
        output:
          `Decomposed content into ${entities.length} separate entity dossiers (one canonical name per note).\n` +
          `Created (${created.length}): ${fmt(created)}\n` +
          `Updated (${updated.length}): ${fmt(updated)}\n` +
          (hubTitle ? `Hub index: [[${hubTitle}]]\n` : "") +
          `Do not merge these into one note — update individual entities by exact title.`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
