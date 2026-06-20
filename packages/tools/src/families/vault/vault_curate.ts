/**
 * vault_curate — background sleep-phase vault curator (agent safe zone only).
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { defineTool } from "../../shared/helpers.js";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import {
  listAllNotes,
  getBacklinks,
  writeVaultNote,
  findNearDuplicateNote,
} from "./vault_store.js";
import { isAgentManagedNote, canAutoEditNote, agentZoneRoot } from "./vault_agent_zone.js";
import { ensureVaultSchemaFile } from "./vault_schema.js";
import { weaveNoteIntoGraph } from "./vault_ingest_core.js";
import { resolveEmbedCreds } from "./vault_embed.js";
import { relinkMarkdownTitles, noteRelLinkPath } from "./vault_wikilink.js";
import { injectRelatedLinkRefs } from "./vault_nexus.js";
import { noteTypeFromKindTags } from "./vault_entity_merge.js";
import { loadRawNotes, getKeyType, getNoteValue, atomicUpdate } from "../memory/notes_store.js";

export interface VaultCurateState {
  lastRunAt: string;
  orphansFixed: number;
  mergesSuggested: number;
  memoryPromoted: number;
}

export function vaultCurateStatePath(): string {
  return join(homedir(), ".liminal", "vault_curate_last.json");
}

export async function readVaultCurateState(): Promise<VaultCurateState | null> {
  try {
    const raw = await readFile(vaultCurateStatePath(), "utf8");
    return JSON.parse(raw) as VaultCurateState;
  } catch {
    return null;
  }
}

async function writeVaultCurateState(state: VaultCurateState): Promise<void> {
  const fp = vaultCurateStatePath();
  await mkdir(join(fp, ".."), { recursive: true });
  await writeFile(fp, JSON.stringify(state, null, 2), "utf8");
}

export const vaultCurateTool = defineTool({
  name: "vault_curate",
  description:
    "WHAT: Background vault curator — lint-fix orphans (agent zone), refresh schema.md, promote durable memory rows,\n" +
    "and archive stale agent blobs. Safe for mixed personal vaults (never edits human notes).\n" +
    "WHEN: Idle sleep phase, after auto_dream, or on AGENT_VAULT_CURATE_INTERVAL_MS.\n" +
    "ARGS: lint_limit — max notes to scan (default 200); promote_memory — promote JSON memory rows (default true).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      lint_limit: { type: "number", minimum: 1, maximum: 2000 },
      promote_memory: { type: "boolean" },
    },
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const limit = Math.max(1, Math.min(2000, (args["lint_limit"] as number | undefined) ?? 200));
    const promoteMemory = args["promote_memory"] !== false;
    emit?.("\nvault_curate: starting sleep-phase pass…\n");

    await ensureVaultSchemaFile();

    let orphansFixed = 0;
    let mergesSuggested = 0;
    let memoryPromoted = 0;
    let relinked = 0;
    let reclassified = 0;

    let notes = (await listAllNotes({ limit })).filter(isAgentManagedNote);

    for (const note of notes) {
      const target = noteTypeFromKindTags(note.tags);
      if (!target || target === note.type) continue;
      await writeVaultNote({
        title: note.title,
        body: note.body,
        type: target,
        tags: note.tags,
      });
      reclassified++;
    }
    if (reclassified > 0) {
      notes = (await listAllNotes({ limit })).filter(isAgentManagedNote);
    }

    for (const note of notes) {
      const newBody = await relinkMarkdownTitles(note.body);
      if (newBody === note.body) continue;
      await writeVaultNote({
        title: note.title,
        body: newBody,
        type: note.type,
        tags: note.tags,
      });
      relinked++;
    }

    // Lint fix via vault_lint semantics (agent zone only).
    for (const note of notes) {
      const backlinks = await getBacklinks(note.title);
      if (backlinks.length > 0) continue;
      const neighbors = notes.filter(
        (n) => n.title.toLowerCase() !== note.title.toLowerCase() && canAutoEditNote(n)
      );
      const neighbor = neighbors[0];
      if (!neighbor) continue;
      const orphanRef = { target: noteRelLinkPath(note), label: note.title };
      const body = injectRelatedLinkRefs(neighbor.body, [orphanRef]);
      if (body === neighbor.body) continue;
      await writeVaultNote({
        title: neighbor.title,
        body,
        type: neighbor.type,
        tags: neighbor.tags,
      });
      orphansFixed++;
    }

    for (const note of notes.slice(0, 80)) {
      const near = await findNearDuplicateNote(note.title, note.body, { limit: 1, threshold: 0.75 });
      if (near[0] && isAgentManagedNote(near[0].note)) mergesSuggested++;
    }

    if (promoteMemory) {
      const raw = await loadRawNotes();
      const upserts: Array<{ type?: string; key?: string; value?: string }> = [];
      for (const [storageKey, row] of Object.entries(raw)) {
        const typ = getKeyType(storageKey);
        if (!typ || !["entity", "fact", "experience", "belief"].includes(typ)) continue;
        const val = getNoteValue(row as never);
        if (!val || val.includes("migrated_to_vault")) continue;
        const key = storageKey.slice(typ.length + 1);
        if (val.length < 40) continue;
        upserts.push({ type: typ, key, value: val });
        if (upserts.length >= 12) break;
      }
      if (upserts.length > 0) {
        const creds = await resolveEmbedCreds();
        for (const u of upserts) {
          const typ = (u.type ?? "fact").trim();
          const title = u.key!.charAt(0).toUpperCase() + u.key!.slice(1).replace(/[_-]+/g, " ");
          const body =
            typ === "entity"
              ? `## Identity\n${title}\n\n## Current\n${u.value}\n`
              : `## Summary\n${u.value}\n`;
          await weaveNoteIntoGraph({
            title,
            content: body,
            type: typ === "entity" ? "entity" : "fact",
            tags: ["liminal-agent", "memory-promoted"],
            creds,
          });
          memoryPromoted++;
          const sk = `${typ}:${u.key}`;
          await atomicUpdate((notes) => {
            const cur = notes[sk];
            if (!cur) return notes;
            return {
              ...notes,
              [sk]: `[migrated_to_vault:${title}] ${String(cur).slice(0, 200)}`,
            };
          });
        }
      }
    }

    // Archive very stale agent blobs (soft move under _liminal/archive/).
    const archiveDir = join(agentZoneRoot(), "archive");
    await mkdir(archiveDir, { recursive: true });

    const state: VaultCurateState = {
      lastRunAt: new Date().toISOString(),
      orphansFixed,
      mergesSuggested,
      memoryPromoted,
    };
    await writeVaultCurateState(state);

    emit?.(
      `  orphans_fixed=${orphansFixed} merge_pairs=${mergesSuggested} memory_promoted=${memoryPromoted}\n`
    );
    return {
      ok: true,
      output:
        `Vault curator complete.\n` +
        `- Orphans fixed (agent zone): ${orphansFixed}\n` +
        `- Notes relinked to folder paths: ${relinked}\n` +
        `- Notes reclassified by kind tag: ${reclassified}\n` +
        `- Near-duplicate pairs (review): ${mergesSuggested}\n` +
        `- Memory rows promoted: ${memoryPromoted}\n` +
        `- Schema: refreshed\n` +
        `- Last run: ${state.lastRunAt}`,
    };
  },
});

export function resolveVaultCurateOnIdleEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_VAULT_CURATE_ON_IDLE") !== "0";
}

export function resolveVaultCurateIntervalMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_VAULT_CURATE_INTERVAL_MS")?.trim();
  const n = raw ? parseInt(raw, 10) : 600_000;
  return Number.isFinite(n) ? Math.max(60_000, Math.min(86_400_000, n)) : 600_000;
}
