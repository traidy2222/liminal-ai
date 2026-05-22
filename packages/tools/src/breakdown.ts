/**
 * breakdown — structured pre-execution analysis.
 *
 * Like think() but schema-enforced: forces the model to articulate the goal,
 * decompose sub-parts, surface unknowns, declare which tool families are needed,
 * and pick an execution strategy — all before touching any tools.
 *
 * The harness consumes `tool_families` to pre-activate the right families so the
 * model never hits "tool not found" mid-task. `clarification_needed` short-circuits
 * to ask_user before any side-effecting tools fire.
 */
import { defineTool } from "./helpers.js";

export type BreakdownRequestType =
  | "research"
  | "coding"
  | "execution"
  | "analysis"
  | "creative"
  | "conversational"
  | "mixed";

export type BreakdownStrategy =
  | "direct"           // simple, answer now
  | "research_first"   // gather info before acting
  | "plan_then_execute"// plan() then run the steps
  | "clarify_first"    // must ask user before proceeding
  | "parallel_branches";// spawn parallel work streams

export type BreakdownScope =
  | "read_only"   // no writes, no side effects
  | "additive"    // creates new files/notes/artifacts
  | "mutating"    // edits existing state
  | "destructive";// deletes, resets, or irreversible change

export type BreakdownComplexity =
  | "trivial"       // 1-2 tool calls
  | "moderate"      // 3-8 tool calls
  | "complex"       // 9+ tool calls, multi-step plan
  | "multi_session";// too large for one session

export interface BreakdownPart {
  id: string;          // "p1", "p2", …
  description: string; // what this part involves
  parallel: boolean;   // can run alongside other parts?
}

export interface BreakdownResult {
  goal: string;
  request_type: BreakdownRequestType;
  parts: BreakdownPart[];
  knowns: string[];
  unknowns: string[];
  tool_families: string[];
  strategy: BreakdownStrategy;
  scope: BreakdownScope;
  complexity: BreakdownComplexity;
  clarification_needed: boolean;
  clarification_question?: string;
}

export const breakdownTool = defineTool({
  name: "breakdown",
  description:
    "WHAT: Structured pre-execution analysis — decompose the request before touching any tools.\n" +
    "WHEN: Any request with ≥2 distinct parts, unknown scope, potential file mutations, or where the right tool families are unclear. Call this BEFORE plan() and before the first side-effecting tool.\n" +
    "NOT WHEN: Simple single-step tasks where intent and tools are obvious (e.g. 'what is X?').\n" +
    "HARNESS EFFECT: Declared tool_families[] are pre-activated automatically — no separate activate_tool_family calls needed for those families. clarification_needed=true pauses execution.\n" +
    "ARGS: goal (restate the core objective), request_type, parts[] (sub-goals with parallel flag), " +
    "knowns[] (facts already in context), unknowns[] (what must be discovered), " +
    "tool_families[] (families needed — shell/git/code_intel/web/memory_advanced/vault/files_edit/tasks/vision/browser/document/markets/harness_ui/orchestration), " +
    "strategy, scope, complexity, clarification_needed, clarification_question.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "Restate the core objective in one sentence",
      },
      request_type: {
        type: "string",
        enum: ["research", "coding", "execution", "analysis", "creative", "conversational", "mixed"],
        description: "Primary character of this request",
      },
      parts: {
        type: "array",
        description: "Distinct sub-goals within this request",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Short id: p1, p2, …" },
            description: { type: "string", description: "What this part involves" },
            parallel: { type: "boolean", description: "Can this run alongside other parts?" },
          },
          required: ["id", "description", "parallel"],
        },
      },
      knowns: {
        type: "array",
        items: { type: "string" },
        description: "Facts already available in context or memory",
      },
      unknowns: {
        type: "array",
        items: { type: "string" },
        description: "Gaps that must be discovered before or during execution",
      },
      tool_families: {
        type: "array",
        items: { type: "string" },
        description:
          "Tool families needed. Valid values: shell, git, code_intel, web, memory_advanced, " +
          "vault, files_edit, tasks, vision, browser, document, markets, harness_ui, orchestration, " +
          "navigation, meta, dynamic_tools, captcha, agenda_scheduler, synthesis, independence",
      },
      strategy: {
        type: "string",
        enum: ["direct", "research_first", "plan_then_execute", "clarify_first", "parallel_branches"],
        description:
          "direct=answer now; research_first=gather before acting; plan_then_execute=plan() then run; " +
          "clarify_first=ask user first; parallel_branches=spawn concurrent work streams",
      },
      scope: {
        type: "string",
        enum: ["read_only", "additive", "mutating", "destructive"],
        description:
          "read_only=no writes; additive=new files/notes; mutating=edits existing state; destructive=deletes/resets",
      },
      complexity: {
        type: "string",
        enum: ["trivial", "moderate", "complex", "multi_session"],
        description: "trivial=1-2 tools; moderate=3-8; complex=9+; multi_session=too large for one session",
      },
      clarification_needed: {
        type: "boolean",
        description: "True if a user answer would materially change the approach",
      },
      clarification_question: {
        type: "string",
        description: "The single most important question to ask (required when clarification_needed=true)",
      },
    },
    required: ["goal", "request_type", "parts", "strategy", "scope", "complexity", "clarification_needed"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const goal = String(args["goal"] ?? "").trim();
    if (!goal) return { ok: false, error: "goal is required." };

    const parts = (args["parts"] as BreakdownPart[] | undefined) ?? [];
    const knowns = (args["knowns"] as string[] | undefined) ?? [];
    const unknowns = (args["unknowns"] as string[] | undefined) ?? [];
    const families = (args["tool_families"] as string[] | undefined) ?? [];
    const strategy = String(args["strategy"] ?? "direct") as BreakdownStrategy;
    const scope = String(args["scope"] ?? "read_only") as BreakdownScope;
    const complexity = String(args["complexity"] ?? "moderate") as BreakdownComplexity;
    const clarificationNeeded = Boolean(args["clarification_needed"]);
    const clarificationQuestion = args["clarification_question"]
      ? String(args["clarification_question"]).trim()
      : undefined;

    if (clarificationNeeded && !clarificationQuestion) {
      return {
        ok: false,
        error: "clarification_question is required when clarification_needed=true.",
      };
    }

    const lines: string[] = [];
    lines.push(`Goal: ${goal}`);
    lines.push(`Type: ${args["request_type"]} | Strategy: ${strategy} | Scope: ${scope} | Complexity: ${complexity}`);

    if (parts.length > 0) {
      lines.push(
        `Parts: ${parts.map((p) => `[${p.id}] ${p.description}${p.parallel ? " (parallel)" : ""}`).join(" · ")}`
      );
    }
    if (unknowns.length > 0) {
      lines.push(`Unknowns: ${unknowns.join(" · ")}`);
    }
    if (knowns.length > 0) {
      lines.push(`Knowns: ${knowns.join(" · ")}`);
    }
    if (families.length > 0) {
      lines.push(`Families to activate: ${families.join(", ")}`);
    }
    if (clarificationNeeded && clarificationQuestion) {
      lines.push(`⚠ Clarification needed: ${clarificationQuestion}`);
    }

    return { ok: true, output: lines.join("\n") };
  },
});
