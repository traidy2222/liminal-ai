import { defineTool } from "./helpers.js";

export const thinkTool = defineTool({
  name: "think",
  description:
    "WHAT: Externalize a reasoning step without taking any action or side effects.\n" +
    "WHEN: Before any non-trivial tool call, complex decision, or when you need to reason through ambiguity. Use freely — it costs nothing.\n" +
    "NOT WHEN: Trivial single-step actions where the path is already clear.\n" +
    "ARGS: content — the reasoning text to emit.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "Reasoning text to emit" },
    },
    required: ["content"],
    additionalProperties: false,
  },
  handler: async (_args) => ({ ok: true as const, output: "✓" }),
});
