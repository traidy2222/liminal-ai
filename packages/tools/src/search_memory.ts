import { defineTool } from "./helpers.js";
import { loadNotes } from "./notes_store.js";

export const searchMemoryTool = defineTool({
  name: "search_memory",
  description:
    "WHAT: Case-insensitive substring search across all stored note keys AND values.\n" +
    "WHEN: You need to find a note but don't know the exact key, or want to discover what was stored about a topic.\n" +
    "NOT WHEN: You already know the exact key — use recall instead.\n" +
    "ARGS: query — substring to match; type — optional filter: fact, experience, entity, belief, reflection, recipe.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Substring to search for in keys and values" },
      type: {
        type: "string",
        description: "Optional: filter to only this memory type (fact, experience, entity, belief, reflection, recipe)",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const query = (args["query"] as string).toLowerCase();
    const typeFilter = args["type"] as string | undefined;
    const notes = await loadNotes();
    const matches = Object.entries(notes).filter(([k, v]) => {
      if (typeFilter && !k.startsWith(`${typeFilter}:`)) return false;
      return k.toLowerCase().includes(query) || v.toLowerCase().includes(query);
    });
    if (matches.length === 0) {
      return { ok: true, output: typeFilter ? `(no matches in ${typeFilter} memories)` : "(no matches)" };
    }
    return {
      ok: true,
      output: matches.map(([k, v]) => `${k}: ${v}`).join("\n"),
    };
  },
});
