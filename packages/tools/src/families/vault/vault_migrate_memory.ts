/**
 * vault_migrate_memory — one-shot promotion of JSON memory → vault dossiers + tag backfill.
 */
import { defineTool } from "../../shared/helpers.js";
import { listAllNotes, writeVaultNote, findNote } from "./vault_store.js";
import {
  isHeuristicAgentNote,
  ensureAgentTags,
  LIMINAL_AGENT_TAG,
  noteHasAgentTag,
} from "./vault_agent_zone.js";
import { weaveNoteIntoGraph } from "./vault_ingest_core.js";
import { resolveEmbedCreds } from "./vault_embed.js";
import { loadRawNotes, atomicUpdate, getKeyType, getNoteValue } from "../memory/notes_store.js";

const DURABLE_TYPES = new Set(["entity", "fact", "experience", "belief", "reflection"]);

export const vaultMigrateMemoryTool = defineTool({
  name: "vault_migrate_memory",
  description:
    "WHAT: One-shot migration — copy durable JSON memory rows into the vault as linked dossiers,\n" +
    "backfill liminal-agent tags on heuristic agent notes, and mark memory rows migrated_to_vault.\n" +
    "WHEN: After enabling vault-primary brain or cleaning an orphan-heavy vault backlog.\n" +
    "ARGS: limit — max memory rows to migrate (default 40); backfill_tags — tag agent notes (default true).",
  requiresApproval: true,
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", minimum: 1, maximum: 200 },
      backfill_tags: { type: "boolean" },
    },
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const limit = Math.max(1, Math.min(200, (args["limit"] as number | undefined) ?? 40));
    const backfillTags = args["backfill_tags"] !== false;
    emit?.("\nvault_migrate_memory: starting…\n");

    let migrated = 0;
    let tagged = 0;
    const creds = await resolveEmbedCreds();
    const raw = await loadRawNotes();

    for (const [storageKey, row] of Object.entries(raw)) {
      if (migrated >= limit) break;
      const typ = getKeyType(storageKey);
      if (!typ || !DURABLE_TYPES.has(typ)) continue;
      const value = getNoteValue(row as never);
      if (!value || value.includes("migrated_to_vault")) continue;
      if (value.length < 20) continue;
      const key = storageKey.slice(typ.length + 1);
      const title = key.charAt(0).toUpperCase() + key.slice(1).replace(/[_-]+/g, " ");
      const existing = await findNote(title);
      if (!existing) {
        const body =
          typ === "entity"
            ? `## Identity\n${title}\n\n## Current\n${value}\n`
            : `## Summary\n${value}\n`;
        await weaveNoteIntoGraph({
          title,
          content: body,
          type: typ === "entity" ? "entity" : typ === "reflection" ? "reflection" : "fact",
          tags: ["liminal-agent", "migrated"],
          creds,
        });
      }
      await atomicUpdate((notes) => {
        const cur = notes[storageKey];
        if (!cur) return notes;
        return {
          ...notes,
          [storageKey]: `[migrated_to_vault:${title}] ${value.slice(0, 180)}`,
        };
      });
      migrated++;
      emit?.(`  → [[${title}]] from ${storageKey}\n`);
    }

    if (backfillTags) {
      const notes = await listAllNotes({ limit: 500 });
      for (const note of notes) {
        if (noteHasAgentTag(note)) continue;
        if (!isHeuristicAgentNote(note)) continue;
        await writeVaultNote({
          title: note.title,
          body: note.body,
          type: note.type,
          tags: ensureAgentTags(note.tags),
        });
        tagged++;
      }
    }

    return {
      ok: true,
      output:
        `Migration complete.\n` +
        `- Memory rows migrated: ${migrated}\n` +
        `- Agent notes tagged with ${LIMINAL_AGENT_TAG}: ${tagged}\n` +
        `Human notes outside the agent zone were not modified.`,
    };
  },
});
