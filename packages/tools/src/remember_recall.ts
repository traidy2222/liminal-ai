import { defineTool } from "./helpers.js";
import { loadNotes, atomicUpdate, makeTypedKey } from "./notes_store.js";

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
      const val = notes[args["key"] as string];
      return val !== undefined
        ? { ok: true, output: val }
        : { ok: false, error: `No note found for key "${args["key"] as string}". Use search_memory if the key is uncertain.` };
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
