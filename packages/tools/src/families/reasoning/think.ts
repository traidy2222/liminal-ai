import { defineTool } from "../../shared/helpers.js";

export const thinkTool = defineTool({
  name: "think",
  description:
    "Optional planning for substantial work or replanning after a surprise; skip for simple tasks. " +
    "Follow the current reasoning budget. Declared tool_families are activated automatically. " +
    "scope configures rollback tracking for mutating/destructive work. " +
    "clarification_needed pauses for the supplied question; use only for genuinely missing information. " +
    "self_check optionally records a post-task score.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The reasoning text — always required",
      },
      tool_families: {
        type: "array",
        items: { type: "string" },
        description:
          "Families to activate for this task; discover valid IDs with list_tool_families. " +
          "For external MCP tools, prefer focused mcp_search_tools discovery over loading broad catalogs.",
      },
      scope: {
        type: "string",
        enum: ["read_only", "additive", "mutating", "destructive"],
        description:
          "read_only=no writes; additive=new files/notes; mutating=edits existing state; " +
          "destructive=deletes/resets/irreversible. Arms compensation ledger on mutating+.",
      },
      unknowns: {
        type: "array",
        items: { type: "string" },
        description: "Gaps that need to be discovered before or during execution",
      },
      clarification_needed: {
        type: "boolean",
        description: "True if a user answer would materially change the approach — pauses execution",
      },
      clarification_question: {
        type: "string",
        description: "The single most important question to ask (required when clarification_needed=true)",
      },
      self_check: {
        type: "number",
        description: "Post-completion quality score 0-100. Use after autonomous work to record assessment.",
        minimum: 0,
        maximum: 100,
      },
    },
    required: ["content"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const families = args["tool_families"] as string[] | undefined;
    const scope = args["scope"] as string | undefined;
    const unknowns = args["unknowns"] as string[] | undefined;
    const selfCheck = args["self_check"] as number | undefined;
    const clarificationNeeded = args["clarification_needed"] as boolean | undefined;

    // Return compact summary when structured fields are present
    const parts: string[] = [];
    if (scope) parts.push(`scope:${scope}`);
    if (families?.length) parts.push(`families:${families.join(",")}`);
    if (unknowns?.length) parts.push(`unknowns:${unknowns.length}`);
    if (selfCheck !== undefined) parts.push(`self_check:${selfCheck}`);
    if (clarificationNeeded) parts.push("clarification_needed");

    return { ok: true as const, output: parts.length ? `✓ [${parts.join(" | ")}]` : "✓" };
  },
});
