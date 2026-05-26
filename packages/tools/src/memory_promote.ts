/**
 * memory_promote — change the federation scope of an existing note.
 *
 * Federation Phase 2 introduces three scopes on every note (chat / workspace
 * / global). New notes default to "workspace" when a fingerprint resolves,
 * else "global". When the agent realizes a chat-local insight is broadly
 * useful — or that a global note is too noisy and should be project-scoped —
 * this tool flips the scope without rewriting the value.
 *
 * Direction is unrestricted: you can promote chat → workspace → global, or
 * demote global → workspace → chat. The note's chatId is preserved either
 * way; only the visibility filter changes.
 */
import { defineTool } from "./helpers.js";
import { loadRawNotes, setNoteScope, getNoteValue, type StoredNote } from "./notes_store.js";

const VALID_SCOPES = ["chat", "workspace", "global"] as const;

export const memoryPromoteTool = defineTool({
  name: "memory_promote",
  description:
    "WHAT: Change a note's federation scope (chat / workspace / global) without rewriting its value.\n" +
    "WHEN: You realize a chat-local fact is broadly useful (promote chat → workspace → global), or a global note " +
    "should be project-scoped (demote → workspace) or conversation-only (demote → chat).\n" +
    "NOT WHEN: You want to change the note's value — use remember() with the same key instead.\n" +
    "ARGS: key — exact storage key (e.g. 'fact:auth-uses-postgres'); to — target scope.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Exact note key, including type prefix when applicable." },
      to: {
        type: "string",
        enum: [...VALID_SCOPES],
        description: "Target scope. 'chat' = only the writing chat. 'workspace' = all chats in the same project. 'global' = every chat.",
      },
    },
    required: ["key", "to"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const key = String(args["key"] ?? "").trim();
    const to = args["to"] as (typeof VALID_SCOPES)[number];
    if (!key) return { ok: false, error: "key is required" };
    if (!VALID_SCOPES.includes(to)) {
      return { ok: false, error: `to must be one of ${VALID_SCOPES.join(", ")}` };
    }
    const raw = await loadRawNotes();
    const existing = raw[key];
    if (existing === undefined) return { ok: false, error: `no note found at key '${key}'` };
    const richBefore = typeof existing === "object" ? (existing as StoredNote) : null;
    const previousScope = richBefore?.scope ?? "global";
    const valuePreview = getNoteValue(existing).slice(0, 80);
    const changed = await setNoteScope(key, to);
    if (!changed) {
      return {
        ok: true,
        output: `'${key}' already at scope=${to}. No change. Value: "${valuePreview}…"`,
      };
    }
    return {
      ok: true,
      output:
        `Promoted '${key}': scope ${previousScope} → ${to}. ` +
        `Value preserved: "${valuePreview}${valuePreview.length === 80 ? "…" : ""}"`,
    };
  },
});
