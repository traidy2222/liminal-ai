import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace } from "./file_path_guard.js";

type RefactorOp = {
  op: "search_replace";
  path: string;
  search: string;
  replace: string;
  regex?: boolean;
  flags?: string;
};

export const refactorPlanApplyTool = defineTool({
  name: "refactor_plan_apply",
  description:
    "WHAT: Two-step refactor helper (plan or apply) with explicit file targets.\n" +
    "WHEN: You want a deterministic reviewable refactor plan before mutation.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["plan", "apply"], description: "plan or apply" },
      operations: { type: "array", items: { type: "object" }, description: "search_replace operations" },
    },
    required: ["mode", "operations"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const mode = String(args["mode"] ?? "plan");
    const ops = (args["operations"] as RefactorOp[]) ?? [];
    const normalized = ops.map((op, i) => {
      const safe = resolveWithinWorkspace(op.path);
      return {
        idx: i + 1,
        valid: safe.ok,
        path: safe.resolvedPath ?? op.path,
        op: op.op,
        regex: Boolean(op.regex),
        flags: op.flags ?? "g",
        search_len: op.search.length,
        replace_len: op.replace.length,
      };
    });
    if (mode === "plan") {
      return {
        ok: true,
        output: JSON.stringify(
          {
            mode,
            op_count: ops.length,
            valid_ops: normalized.filter((n) => n.valid).length,
            operations: normalized,
            note: "Run mode=apply with same operations after review.",
          },
          null,
          2
        ),
      };
    }
    return {
      ok: true,
      output: JSON.stringify(
        {
          mode,
          op_count: ops.length,
          next_tool: "multi_file_apply",
          recommended_operations: ops.map((o) => ({
            op: "search_replace",
            path: o.path,
            search: o.search,
            replace: o.replace,
            regex: o.regex ?? false,
            flags: o.flags ?? "g",
          })),
        },
        null,
        2
      ),
    };
  },
});

