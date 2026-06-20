/**
 * vault_ingest_source — Karpathy raw/ layer + multi-page fan-out from one source.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { defineTool } from "../../shared/helpers.js";
import { titleToSlug, getVaultDir } from "./vault_store.js";
import { resolveEmbedCreds } from "./vault_embed.js";
import { weaveNoteIntoGraph, upsertMocForTopic } from "./vault_ingest_core.js";
import { extractEntities } from "./vault_entity_extract.js";
import { mergeEntity, entityNoteTypeFor, tagsForExtractedKind, type ExtractedEntity } from "./vault_entity_merge.js";
import { ensureAgentTags, agentZoneRoot } from "./vault_agent_zone.js";
import { formatWikilink } from "./vault_wikilink.js";

export const vaultIngestSourceTool = defineTool({
  name: "vault_ingest_source",
  description:
    "WHAT: Ingest an immutable raw source (URL clip, transcript, article) into _liminal/raw/ and fan out updates\n" +
    "across the wiki — entities, concepts, synthesis — with ## Sources backlinks to the raw note.\n" +
    "WHEN: After web_fetch or research; one source should touch many wiki pages (Karpathy ingest pattern).\n" +
    "ARGS: title, content (markdown/text), source_url optional.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Human title for this source" },
      content: { type: "string", description: "Full markdown or text body" },
      source_url: { type: "string", description: "Original URL if known" },
      topic: { type: "string", description: "Optional topic label for MOC upsert" },
    },
    required: ["title", "content"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    try {
      const title = String(args["title"] ?? "").trim();
      const content = String(args["content"] ?? "");
      const sourceUrl = String(args["source_url"] ?? "").trim();
      const topic = String(args["topic"] ?? title).trim();
      if (!title || content.trim().length < 40) {
        return { ok: false, error: "vault_ingest_source needs title and substantial content." };
      }

      const date = new Date().toISOString().slice(0, 10);
      const slug = `${date}-${titleToSlug(title)}`;
      const rawDir = join(agentZoneRoot(), "raw");
      await mkdir(rawDir, { recursive: true });
      const rawPath = join(rawDir, `${slug}.md`);
      const rawFm = [
        "---",
        `title: "${title.replace(/"/g, '\\"')}"`,
        "type: source",
        `tags: [liminal-agent, raw]`,
        `source_url: ${sourceUrl ? `"${sourceUrl.replace(/"/g, '\\"')}"` : '""'}`,
        `ingested_at: ${new Date().toISOString()}`,
        "---",
        "",
        `# ${title}`,
        "",
        content.trim(),
      ].join("\n");
      await writeFile(rawPath, rawFm, "utf8");
      const rawLinkTarget = relative(getVaultDir(), rawPath)
        .replace(/\\/g, "/")
        .replace(/\.md$/i, "");
      const rawWikilink = formatWikilink(rawLinkTarget, title);
      emit?.(`\nvault_ingest_source: raw → ${rawPath}\n`);

      const creds = await resolveEmbedCreds();
      const touched: string[] = [];

      await weaveNoteIntoGraph({
        title: `Source — ${title}`,
        content:
          `## Summary\n${content.slice(0, 1200)}\n\n` +
          (sourceUrl ? `## Origin\n${sourceUrl}\n` : ""),
        type: "source",
        tags: ensureAgentTags(["source"]),
        sourceLinkTitles: [rawLinkTarget],
        creds,
      });
      touched.push(`Source — ${title}`);

      const extracted = await extractEntities(content, { maxEntities: 14 });
      for (const e of extracted.entities as ExtractedEntity[]) {
        const { body } = mergeEntity(null, e, date);
        const noteType = entityNoteTypeFor(e.kind);
        await weaveNoteIntoGraph({
          title: e.name,
          content: body,
          type: noteType,
          tags: ensureAgentTags(tagsForExtractedKind(e.kind)),
          summary: e.summary,
          sourceLinkTitles: [rawLinkTarget],
          creds,
        });
        touched.push(e.name);
      }

      if (touched.length >= 2) {
        await upsertMocForTopic(topic, touched, creds);
      }

      const synthTitle = `Synthesis — ${topic}`;
      await weaveNoteIntoGraph({
        title: synthTitle,
        content: `## Overview\nEvolving synthesis from ${rawWikilink}.\n\n## Key points\n${content.slice(0, 2000)}`,
        type: "synthesis",
        tags: ensureAgentTags(["synthesis"]),
        sourceLinkTitles: [rawLinkTarget],
        creds,
      });

      return {
        ok: true,
        output:
          `Ingested source "${title}" → ${rawPath}\n` +
          `Raw wikilink: ${rawWikilink}\n` +
          `Wiki pages touched (${touched.length}): ${touched.join(", ")}\n` +
          `Synthesis: [[${synthTitle}]]`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
