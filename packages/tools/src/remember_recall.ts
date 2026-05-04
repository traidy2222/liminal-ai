import { defineTool } from "./helpers.js";
import {
  loadNotes,
  loadRawNotes,
  atomicUpdate,
  makeTypedKey,
  bumpNoteMetadata,
  mergeNoteGraphFields,
  type StoredNote,
} from "./notes_store.js";
import { rankDocumentsForQuery } from "@liminal/core";
import { suggestWikilinkLine } from "./memory_autolink.js";

const MEMORY_TYPES = ["fact", "experience", "entity", "belief", "reflection", "recipe"] as const;
type MemoryType = (typeof MEMORY_TYPES)[number];

export const rememberTool = defineTool({
  name: "remember",
  description:
    "WHAT: Persist a key-value note that survives across turns and sessions.\n" +
    "WHEN: Important facts, user preferences, project-specific constants, or any info you'll need later.\n" +
    "NOT WHEN: Ephemeral per-turn state, intermediate calculation results, or info already in context.\n" +
    "ARGS: key — short identifier; value — the text to store; type — optional category: fact, experience, entity, belief, reflection, recipe.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Short identifier for the note" },
      value: { type: "string", description: "Text to store" },
      type: {
        type: "string",
        enum: [...MEMORY_TYPES],
        description: `Optional memory category: ${MEMORY_TYPES.join(", ")}. Omit for general notes.`,
      },
    },
    required: ["key", "value"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const rawKey = args["key"] as string;
    const value = args["value"] as string;
    const memType = args["type"] as MemoryType | undefined;
    const storageKey = memType ? makeTypedKey(memType, rawKey) : rawKey;
    // Use atomic write queue (#4) to prevent concurrent sub-agent data loss
    await atomicUpdate((notes) => ({ ...notes, [storageKey]: value }));

    if (process.env["AGENT_MEMORY_GRAPH"] === "1") {
      const plain = await loadNotes();
      const otherKeys = Object.keys(plain).filter((x) => x !== storageKey);
      if (otherKeys.length > 0) {
        const docs = otherKeys.map((id) => ({ id, text: `${id} ${plain[id]}` }));
        const ranked = rankDocumentsForQuery(value.slice(0, 800), docs, { limit: 10 });
        const linkKeys = ranked
          .map((r) => r.id)
          .filter((id) => id !== storageKey)
          .slice(0, 5);
        if (linkKeys.length > 0) await mergeNoteGraphFields(storageKey, { links: linkKeys });
      }
    }

    if (process.env["AGENT_MEMORY_AUTOLINK"] === "1") {
      const all = await loadNotes();
      const candidateTitles = Object.keys(all)
        .filter((k) => k !== storageKey)
        .slice(0, 60);
      const extra = await suggestWikilinkLine({
        title: storageKey,
        body: value,
        candidateTitles,
      });
      if (extra && !value.includes("[[")) {
        await atomicUpdate((notes) => ({
          ...notes,
          [storageKey]: (notes[storageKey] ?? value) + extra,
        }));
      }
    }

    return { ok: true, output: `Remembered "${storageKey}"` };
  },
});

export const recallTool = defineTool({
  name: "recall",
  description:
    "WHAT: Retrieve a stored note by exact key. Omit key to list all stored keys.\n" +
    "WHEN: You know the exact key you stored earlier.\n" +
    "NOT WHEN: Key is unknown or uncertain — use search_memory to find it by content instead.\n" +
    "ARGS: key — exact key to fetch (optional; omit to list all keys).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Key to retrieve (omit to list all keys)" },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const notes = await loadNotes();
    if (args["key"]) {
      const key = args["key"] as string;
      const val = notes[key];
      if (val !== undefined) void bumpNoteMetadata([key]);
      return val !== undefined
        ? { ok: true, output: val }
        : { ok: false, error: `No note found for key "${key}". Use search_memory if the key is uncertain.` };
    }
    const keys = Object.keys(notes);
    return {
      ok: true,
      output: keys.length > 0 ? keys.join(", ") : "(no notes stored)",
    };
  },
});

export const recallByTypeTool = defineTool({
  name: "recall_type",
  description:
    `WHAT: Retrieve all memories of a specific category.\n` +
    `WHEN: You want all stored facts, past experiences, reflections, or recipes at once.\n` +
    `NOT WHEN: You know the exact key — use recall instead.\n` +
    `ARGS: type — one of: ${MEMORY_TYPES.join(", ")}.`,
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description: `Memory category to retrieve: ${MEMORY_TYPES.join(", ")}`,
      },
    },
    required: ["type"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const memType = args["type"] as string;
    const prefix = `${memType}:`;
    const notes = await loadNotes();
    const matches = Object.entries(notes)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => `[${k.slice(prefix.length)}]\n${v}`)
      .join("\n\n");
    return {
      ok: true,
      output: matches || `(no ${memType} memories stored)`,
    };
  },
});

// ─── New memory management tools ──────────────────────────────────────────────

export const forgetTool = defineTool({
  name: "forget",
  description:
    "WHAT: Delete a specific memory by exact key.\n" +
    "WHEN: A stored fact is wrong, outdated, or no longer relevant.\n" +
    "NOT WHEN: You want to clear an entire category — use forget_type instead.\n" +
    "ARGS: key — exact key to delete (use search_memory or recall() first if unsure of the key).",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Exact key of the memory to delete" },
    },
    required: ["key"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const targetKey = args["key"] as string;
    let found = false;
    await atomicUpdate((notes) => {
      if (!(targetKey in notes)) return notes;
      found = true;
      const updated = { ...notes };
      delete updated[targetKey];
      return updated;
    });
    return found
      ? { ok: true, output: `Deleted memory: "${targetKey}"` }
      : { ok: false, error: `No memory found for key "${targetKey}". Use search_memory to find the correct key.` };
  },
});

export const forgetTypeTool = defineTool({
  name: "forget_type",
  description:
    "WHAT: Delete ALL memories of a given type at once.\n" +
    "WHEN: Clearing stale beliefs after a project changes, resetting old reflections, pruning expired entities.\n" +
    "NOT WHEN: You want to delete one specific entry — use forget(key) instead.\n" +
    "WARNING: This is irreversible. Use recall_type or memory_stats to review first.\n" +
    "ARGS: type — one of: fact, experience, entity, belief, reflection, recipe, harness.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [...MEMORY_TYPES, "harness"],
        description: `Memory category to clear: ${[...MEMORY_TYPES, "harness"].join(", ")}`,
      },
    },
    required: ["type"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const memType = args["type"] as string;
    const prefix = `${memType}:`;
    let count = 0;
    await atomicUpdate((notes) => {
      const updated: Record<string, string> = {};
      for (const [k, v] of Object.entries(notes)) {
        if (k.startsWith(prefix)) {
          count++;
        } else {
          updated[k] = v;
        }
      }
      return updated;
    });
    return {
      ok: true,
      output: count > 0
        ? `Deleted ${count} ${memType} memor${count === 1 ? "y" : "ies"}.`
        : `(no ${memType} memories found — nothing deleted)`,
    };
  },
});

export const memoryStatsTool = defineTool({
  name: "memory_stats",
  description:
    "WHAT: Show a grouped summary of all stored memories with counts and recency info.\n" +
    "WHEN: At session start to understand what you know, before searching, or to decide what to forget.\n" +
    "ARGS: none.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args) => {
    const raw = await loadRawNotes();
    const groups: Record<string, { count: number; newest?: string }> = {};
    for (const [k, v] of Object.entries(raw)) {
      const colon = k.indexOf(":");
      const type = colon > 0 ? k.slice(0, colon) : "general";
      const updatedAt = typeof v === "string" ? undefined : (v as StoredNote).updatedAt;
      const existing = groups[type];
      if (!existing) {
        groups[type] = { count: 1, newest: updatedAt };
      } else {
        existing.count++;
        if (updatedAt && (!existing.newest || updatedAt > existing.newest)) {
          existing.newest = updatedAt;
        }
      }
    }
    const total = Object.values(groups).reduce((a, b) => a + b.count, 0);
    if (total === 0) return { ok: true, output: "(no memories stored)" };
    const lines = Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, g]) =>
        `  ${type}: ${g.count}${g.newest ? ` (newest: ${g.newest.slice(0, 10)})` : ""}`
      );

    const staleCut = Date.now() - 90 * 86400 * 1000;
    const staleKeys: string[] = [];
    for (const [k, v] of Object.entries(raw)) {
      const u =
        typeof v === "object" && v !== null && "updatedAt" in v
          ? new Date((v as StoredNote).updatedAt).getTime()
          : NaN;
      if (!Number.isNaN(u) && u < staleCut) staleKeys.push(k);
    }
    const staleLine =
      staleKeys.length > 0
        ? `\nStale (not updated in 90d, ${staleKeys.length} keys): ${staleKeys.slice(0, 25).join(", ")}${staleKeys.length > 25 ? "…" : ""}\n→ consider forget() or memory_consolidate()`
        : "\nNo entries older than 90d by updatedAt.";

    return {
      ok: true,
      output: `Total: ${total} memories\n${lines.join("\n")}${staleLine}`,
    };
  },
});
