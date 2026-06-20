/**
 * vault_ingest — the LLM-wiki "nexus" writer (bidirectional graph weave).
 */
import { defineTool } from "../../shared/helpers.js";
import { findNote, type NoteType } from "./vault_store.js";
import { resolveEmbedCreds } from "./vault_embed.js";
import { weaveNoteIntoGraph } from "./vault_ingest_core.js";
import { ensureAgentTags } from "./vault_agent_zone.js";

export const vaultIngestTool = defineTool({
  name: "vault_ingest",
  description:
    "WHAT: Write a vault note AND weave it into the knowledge graph — the connected way to grow the brain.\n" +
    "Finds the nearest existing notes (semantic + keyword), auto-adds real [[Wikilinks]] to them, updates up to 3\n" +
    "neighbors with inbound backlinks, and keeps index.md + log.md up to date. Prefer this over vault_write.\n" +
    "WHEN: Single-subject brief or one entity dossier (type=entity with ## Identity / ## Current / ## Relationships).\n" +
    "To update an existing note, reuse its exact title (overwrites in place, keeps created date).\n" +
    "ARGS: title — note title; content — markdown body; type — fact|entity|concept|source|synthesis|moc|…; tags; summary.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Note title — lookup key and Obsidian filename" },
      content: {
        type: "string",
        description: "Markdown body. Wikilinks to related notes are added automatically.",
      },
      type: {
        type: "string",
        enum: [
          "fact",
          "entity",
          "reflection",
          "recipe",
          "task",
          "note",
          "episode",
          "concept",
          "source",
          "synthesis",
          "moc",
        ],
        description: "Note type (default note)",
      },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
      summary: {
        type: "string",
        description: "Optional one-line summary used in the index.md catalog",
      },
    },
    required: ["title", "content"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    try {
      const title = String(args["title"] ?? "").trim();
      const content = String(args["content"] ?? "");
      const type = (args["type"] as NoteType | undefined) ?? "note";
      const tags = ensureAgentTags((args["tags"] as string[] | undefined) ?? []);
      const summary = (args["summary"] as string | undefined)?.trim();
      if (!title) return { ok: false, error: "vault_ingest requires a non-empty title." };

      emit?.(`\nvault_ingest: "${title}" (${type})\n`);
      const existed = !!(await findNote(title));

      const creds = await resolveEmbedCreds();
      const result = await weaveNoteIntoGraph({
        title,
        content,
        type,
        tags,
        summary,
        creds,
      });

      emit?.(
        `  neighbors: ${result.mode} → outbound ${result.linkTitles.length}, inbound ${result.inboundUpdated.length}\n`
      );

      const action = existed ? "Updated" : "Created";
      emit?.(`  ✓ ${action.toLowerCase()}: ${result.slug}\n`);
      const linkLine =
        result.linkTitles.length > 0
          ? `Linked to: ${result.linkTitles.map((t) => `[[${t}]]`).join(", ")}`
          : "No existing neighbors found yet (first note in this area).";
      const inboundLine =
        result.inboundUpdated.length > 0
          ? `\nInbound backlinks added on: ${result.inboundUpdated.map((t) => `[[${t}]]`).join(", ")}`
          : "";
      return {
        ok: true,
        output:
          `${action} vault note "${title}" (${type}) and wove it into the graph.\n` +
          `${linkLine}${inboundLine}\nSlug: ${result.slug}  |  retrieval: ${result.mode}`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
