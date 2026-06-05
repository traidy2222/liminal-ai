/**
 * vault_ingest — the LLM-wiki "nexus" writer.
 *
 * Unlike vault_write (a dumb create/overwrite), vault_ingest weaves the note
 * into the knowledge graph (Karpathy LLM-Wiki pattern):
 *   1. find semantically + lexically nearest existing notes
 *   2. write the note, auto-injecting real [[wikilinks]] to those neighbors
 *   3. update the navigation spine (index.md catalog + log.md timeline)
 *   4. upsert the note into the vault embedding index so it's findable next time
 *
 * Link density — not note count — is what makes a vault a brain, so every write
 * here also creates connections.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineTool } from "./helpers.js";
import {
  writeVaultNote,
  findNote,
  searchVault,
  getVaultDir,
  type NoteType,
} from "./vault_store.js";
import { upsertVaultEmbeddings } from "./vault_index.js";
import { resolveEmbedCreds, semanticVaultHits, type EmbedCreds } from "./vault_embed.js";
import {
  selectCrossLinks,
  injectRelatedLinks,
  appendLogLine,
  upsertIndexEntry,
  type NeighborCandidate,
} from "./vault_nexus.js";

/** Merge semantic (cosine) + lexical (BM25 rank) neighbors, taking the max score per title. */
async function gatherNeighbors(
  title: string,
  content: string,
  creds: EmbedCreds | null
): Promise<{ candidates: NeighborCandidate[]; mode: "hybrid" | "bm25" }> {
  const byTitle = new Map<string, NeighborCandidate>();
  const add = (c: NeighborCandidate) => {
    const key = c.title.trim().toLowerCase();
    if (!key) return;
    const prev = byTitle.get(key);
    if (!prev || c.score > prev.score) byTitle.set(key, c);
  };

  let mode: "hybrid" | "bm25" = "bm25";
  const hits = await semanticVaultHits(`${title}\n\n${content}`, 12, creds);
  if (hits.length > 0) {
    mode = "hybrid";
    for (const hit of hits) add({ title: hit.title, slug: hit.slug, score: hit.score });
  }

  // BM25 lexical neighbors (always — complements semantic, covers cold index).
  try {
    const results = await searchVault(`${title} ${content.slice(0, 240)}`);
    results.slice(0, 12).forEach((r, i) => {
      add({ title: r.note.title, slug: r.note.slug, score: Math.max(0.18, 0.6 - i * 0.04) });
    });
  } catch {
    /* vault may be empty */
  }

  return { candidates: [...byTitle.values()], mode };
}

async function updateSpineFile(
  fileName: string,
  transform: (existing: string) => string
): Promise<void> {
  const fp = join(getVaultDir(), fileName);
  let existing = "";
  try {
    existing = await readFile(fp, "utf8");
  } catch {
    /* new file */
  }
  await writeFile(fp, transform(existing), "utf8");
}

export const vaultIngestTool = defineTool({
  name: "vault_ingest",
  description:
    "WHAT: Write a vault note AND weave it into the knowledge graph — the connected way to grow the brain.\n" +
    "Finds the nearest existing notes (semantic + keyword), auto-adds real [[Wikilinks]] to them, and keeps\n" +
    "the vault's index.md catalog + log.md timeline up to date. Prefer this over vault_write for durable,\n" +
    "reusable knowledge about ONE topic so notes never land as orphans.\n" +
    "For many entities: parallel vault_write (one dossier per name) or vault_ingest_entities on combined text.\n" +
    "WHEN: Single-subject brief or one entity dossier (type=entity with ## Identity / ## Current / ## Relationships).\n" +
    "To update an existing note, reuse its exact title (overwrites in place, keeps created date).\n" +
    "ARGS: title — note title (lookup key); content — markdown body (you may include your own [[Wikilinks]]);\n" +
    "type — fact|entity|reflection|recipe|task|note|episode (default note); tags — optional; " +
    "summary — optional one-line catalog summary for index.md.",
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
        enum: ["fact", "entity", "reflection", "recipe", "task", "note", "episode"],
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
      const tags = (args["tags"] as string[] | undefined) ?? [];
      const summary =
        (args["summary"] as string | undefined)?.trim() ||
        content.replace(/^#+\s+/gm, "").replace(/\[\[|\]\]/g, "").replace(/\n+/g, " ").trim().slice(0, 160);
      if (!title) return { ok: false, error: "vault_ingest requires a non-empty title." };

      emit?.(`\nvault_ingest: "${title}" (${type})\n`);
      const existed = !!(await findNote(title));

      const creds = await resolveEmbedCreds();
      const { candidates, mode } = await gatherNeighbors(title, content, creds);
      const linkTitles = selectCrossLinks(title, candidates, { max: 8, minScore: 0.15 });
      emit?.(`  neighbors: ${candidates.length} (${mode}) → linking ${linkTitles.length}\n`);

      const body = injectRelatedLinks(content, linkTitles);
      const { slug } = await writeVaultNote({ title, body, type, tags });

      // Embedding index upsert (best-effort; keeps the note paraphrase-findable).
      if (creds) {
        try {
          await upsertVaultEmbeddings({
            apiKey: creds.apiKey,
            baseURL: creds.baseURL,
            model: creds.model,
            notes: [{ slug, title, type, body }],
          });
        } catch {
          /* non-fatal */
        }
      }

      // Navigation spine.
      const date = new Date().toISOString().slice(0, 10);
      try {
        await updateSpineFile("index.md", (cur) => upsertIndexEntry(cur, { title, type, summary }));
        await updateSpineFile("log.md", (cur) =>
          appendLogLine(cur, { date, action: existed ? "update" : "ingest", title })
        );
      } catch {
        /* spine is convenience, never fatal */
      }

      const action = existed ? "Updated" : "Created";
      emit?.(`  ✓ ${action.toLowerCase()}: ${slug} (+${linkTitles.length} links)\n`);
      const linkLine =
        linkTitles.length > 0
          ? `Linked to: ${linkTitles.map((t) => `[[${t}]]`).join(", ")}`
          : "No existing neighbors found yet (first note in this area).";
      return {
        ok: true,
        output:
          `${action} vault note "${title}" (${type}) and wove it into the graph.\n` +
          `${linkLine}\nSlug: ${slug}  |  retrieval: ${mode}`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
