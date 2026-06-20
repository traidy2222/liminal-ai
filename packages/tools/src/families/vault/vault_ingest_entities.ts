/**
 * vault_ingest_entities — decompose content into a knowledge graph of entity notes.
 */
import { defineTool } from "../../shared/helpers.js";
import { findNote } from "./vault_store.js";
import { resolveEmbedCreds } from "./vault_embed.js";
import { appendLogLine } from "./vault_nexus.js";
import { extractEntities } from "./vault_entity_extract.js";
import { mergeEntity, entityNoteTypeFor, tagsForExtractedKind, type ExtractedEntity } from "./vault_entity_merge.js";
import { weaveNoteIntoGraph, updateSpineFile, upsertMocForTopic } from "./vault_ingest_core.js";
import { ensureAgentTags } from "./vault_agent_zone.js";

export const vaultIngestEntitiesTool = defineTool({
  name: "vault_ingest_entities",
  description:
    "WHAT: Turn content into a knowledge GRAPH — one atomic note per entity (person, org/business, place, event, concept).\n" +
    "Each dossier merges into existing notes and gets bidirectional [[wikilinks]] to semantic neighbors.\n" +
    "WHEN: Multi-entity research, cast lists, or combined text to split into entity pages.\n" +
    "ARGS: content — raw text; source — topic label (MOC/hub when 2+ entities); hub_title optional; max_entities.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "Text to decompose into entity notes" },
      source: {
        type: "string",
        description: "Optional source label — when set, writes a MOC/hub note linking all extracted entities",
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
      emit?.(`\nvault_ingest_entities: extracting subjects (fast model)…\n`);

      const extracted = await extractEntities(content, { maxEntities });
      const entities = extracted.entities;
      if (entities.length === 0) {
        emit?.(`  ✗ extraction failed: ${extracted.error ?? "no subjects"}\n`);
        return {
          ok: false,
          error:
            extracted.error ??
            "No entities extracted. For one entity dossier use vault_ingest with title = canonical name.",
        };
      }

      emit?.(
        `  found ${entities.length} subjects — weaving into vault (${entities.map((e) => e.kind).join(", ")})…\n`
      );

      const creds = await resolveEmbedCreds();
      const date = new Date().toISOString().slice(0, 10);
      const created: string[] = [];
      const updated: string[] = [];
      const entityTitles: string[] = [];

      for (const e of entities as ExtractedEntity[]) {
        const title = e.name;
        entityTitles.push(title);
        const existing = await findNote(title);
        const { body } = mergeEntity(existing?.body ?? null, e, date);
        const type = entityNoteTypeFor(e.kind);
        const tags = ensureAgentTags(tagsForExtractedKind(e.kind));

        emit?.(`  → ${title} (${type}/${e.kind})…\n`);
        await weaveNoteIntoGraph({
          title,
          content: body,
          type,
          tags,
          summary: e.summary || e.current || "",
          creds,
          maxInbound: 3,
        });

        (existing ? updated : created).push(title);
        emit?.(`  ${existing ? "↻" : "+"} [[${title}]] (${type}/${e.kind}, ${e.relationships?.length ?? 0} rels)\n`);
      }

      const eventRow = entities.find((ent) => ent.kind === "event");
      const sourceLabel = (args["source"] as string | undefined)?.trim();
      const hubTitle =
        (args["hub_title"] as string | undefined)?.trim() ||
        (sourceLabel ? sourceLabel : "") ||
        (entities.length >= 2 && eventRow ? `${eventRow.name} — entities` : "") ||
        (entities.length >= 2 ? `Entity cluster (${date})` : "");

      let mocTitle: string | null = null;
      if (hubTitle && entities.length >= 1) {
        const topic = sourceLabel || hubTitle;
        mocTitle = await upsertMocForTopic(topic, entityTitles, creds);
        if (!mocTitle) {
          const hubBody =
            `## Overview\nIndex of related entity dossiers (${date}).\n\n` +
            `## Entities\n${entities.map((ent) => `- [[${ent.name}]] — ${ent.kind}`).join("\n")}`;
          await weaveNoteIntoGraph({
            title: hubTitle,
            content: hubBody,
            type: "moc",
            tags: ensureAgentTags(["hub", "moc"]),
            creds,
            maxInbound: 2,
          });
          mocTitle = hubTitle;
        }
        emit?.(`  ⊕ hub/MOC: [[${mocTitle}]]\n`);
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
          `Decomposed content into ${entities.length} separate entity dossiers with bidirectional links.\n` +
          `Created (${created.length}): ${fmt(created)}\n` +
          `Updated (${updated.length}): ${fmt(updated)}\n` +
          (mocTitle ? `Hub/MOC: [[${mocTitle}]]\n` : "") +
          `Update individual entities by exact title.`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
