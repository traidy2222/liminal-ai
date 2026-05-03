import { defineTool } from "./helpers.js";
import { loadNotes, atomicUpdate } from "./notes_store.js";

/**
 * Meta-Harness Self-Evolution Tools (#1 — AHE arXiv:2604.25850)
 *
 * suggest_improvement — let the agent propose new rules for its own system prompt.
 * view_insights       — list all improvement suggestions logged across sessions.
 *
 * Suggestions are persisted as "harness:suggestion:{timestamp}" notes, making
 * them queryable via recall/search_memory and reviewable by a human operator.
 */

export const suggestImprovementTool = defineTool({
  name: "suggest_improvement",
  description:
    "WHAT: Record a proposed improvement to your own reasoning rules or system prompt.\n" +
    "WHEN: You notice a recurring failure pattern, a missing rule, or a better approach than what your guidelines currently say.\n" +
    "NOT WHEN: One-off errors — only log patterns that have happened ≥ 2 times.\n" +
    "ARGS: observation — what recurring pattern you noticed; suggestion — the specific new rule or guideline to add.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      observation: {
        type: "string",
        description: "The recurring pattern or failure you observed",
      },
      suggestion: {
        type: "string",
        description: "The specific rule or guideline you propose adding to your own system prompt",
      },
    },
    required: ["observation", "suggestion"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const key = `harness:suggestion:${Date.now()}`;
    const value =
      `OBSERVATION: ${args["observation"] as string}\n` +
      `SUGGESTION: ${args["suggestion"] as string}`;
    // Use atomic write queue (#4) for concurrent safety
    await atomicUpdate((notes) => ({ ...notes, [key]: value }));
    return {
      ok: true,
      output:
        `Improvement logged as "${key}".\n` +
        `A human reviewer can apply it to the system prompt. ` +
        `Use view_insights() to see all logged suggestions.`,
    };
  },
});

export const viewInsightsTool = defineTool({
  name: "view_insights",
  description:
    "WHAT: List all logged harness improvement suggestions from this and past sessions.\n" +
    "WHEN: Reviewing what patterns have been observed, or before suggest_improvement to avoid duplicates.\n" +
    "ARGS: none.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  handler: async (_args) => {
    const notes = await loadNotes();
    const insights = Object.entries(notes)
      .filter(([k]) => k.startsWith("harness:suggestion:"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `[${k}]\n${v}`)
      .join("\n\n---\n\n");
    return {
      ok: true,
      output: insights || "(no improvement suggestions logged yet)",
    };
  },
});
