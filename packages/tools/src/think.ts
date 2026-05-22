import { defineTool } from "./helpers.js";

export const thinkTool = defineTool({
  name: "think",
  description:
    "WHAT: Deep planning and orientation — use before major work or after unexpected results to re-orient. " +
    "This is the planning channel, not the inference channel. For quick between-step logical inference ('given this result, therefore X'), use reason() instead.\n" +
    "WHEN: (1) Before non-trivial work when scope/families/approach are unclear — fill structured fields (harness pre-activates families). " +
    "Depth follows [REASONING BUDGET] think= field: brief = scope + families + ≤3 bullets (no pseudocode); standard/deep when budget allows. " +
    "If toolFirst=yes, keep think() short then call tools immediately. " +
    "(2) After a surprising/blocking result that requires re-orienting the whole approach — use think() to replan. " +
    "(3) Post-completion: set self_check (0-100) to record quality assessment.\n" +
    "NOT WHEN: Trivial single-step asks, or when [REASONING BUDGET] says think=skip, or when you just need to interpret a tool result and pick a next step — use reason() for that.\n" +
    "HARNESS EFFECT: tool_families[] → pre-activated automatically (no activate_tool_family calls needed). " +
    "clarification_needed=true → pauses execution and surfaces question to user. " +
    "scope declared → arms compensation ledger on mutating/destructive work.\n" +
    "ARGS: content (required — planning text); " +
    "tool_families[] (families needed: shell/git/code_intel/web/memory_advanced/vault/files_edit/tasks/vision/browser/document/markets/harness_ui/orchestration/navigation/meta/dynamic_tools); " +
    "scope (read_only|additive|mutating|destructive); " +
    "unknowns[] (gaps to resolve before acting); " +
    "clarification_needed + clarification_question; " +
    "self_check (0-100, post-task quality score).",
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
          "Tool families needed for this task. Declaring them here pre-activates them — " +
          "no separate activate_tool_family calls needed. Valid: shell, git, code_intel, web, " +
          "memory_advanced, vault, files_edit, tasks, vision, browser, document, markets, " +
          "harness_ui, orchestration, navigation, meta, dynamic_tools, captcha, agenda_scheduler",
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
