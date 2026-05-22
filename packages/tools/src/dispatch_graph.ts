/**
 * dispatch_graph — hint tool for declaring intra-round tool dependencies.
 *
 * The model calls this BEFORE (or alongside) the tool calls it wants to sequence.
 * The dispatcher reads the registered DAG and executes batches in topological order,
 * with parallel execution within each independent group.
 *
 * Example:
 *   dispatch_graph({ deps: { "call_3": ["call_1", "call_2"] } })
 *   read_file(...)     // becomes call_1
 *   web_fetch(...)     // becomes call_2
 *   write_file(...)    // becomes call_3 — waits for call_1 AND call_2
 *
 * The tool call IDs in deps refer to the provider-assigned call ids in the same
 * round. The dispatcher reads them from the accumulated tool batch.
 *
 * This tool is a pure declaration — it has no side effects and always returns ok.
 */

import type { AgentHarness } from "@liminal/core";
import { defineTool } from "./helpers.js";

export function createDispatchGraphTool(harness: AgentHarness) {
  return defineTool({
    name: "dispatch_graph",
    description:
      "Declare dependency edges between tool calls in the current round. " +
      "The harness will execute independent calls in parallel and sequence dependent " +
      "calls after their prerequisites complete. " +
      "deps format: { '<dependent_call_id>': ['<prereq_id_1>', '<prereq_id_2>'] }. " +
      "Call this alongside your other tools — not before them in a separate round.",
    parameters: {
      type: "object",
      properties: {
        deps: {
          type: "object",
          description:
            "Map of dependent call-id → array of prerequisite call-ids. " +
            "Call IDs match the id field in the tool_calls array from the provider response.",
        },
        note: {
          type: "string",
          description: "Optional human-readable note about why this ordering is needed.",
          maxLength: 200,
        },
      },
      required: ["deps"],
    },
    requiresApproval: false,
    cacheable: false,
    handler: async (args) => {
      const deps = args["deps"] as Record<string, unknown> | undefined;
      if (!deps || typeof deps !== "object") {
        return { ok: false, error: "deps must be an object mapping call-ids to arrays of prerequisite call-ids" };
      }

      // Register with harness DAG
      const dag = harness.getToolDag();
      const normalized: Record<string, string[]> = {};
      for (const [key, val] of Object.entries(deps)) {
        if (!Array.isArray(val)) continue;
        normalized[key] = val.filter((v): v is string => typeof v === "string");
      }
      dag.register({ deps: normalized });

      const edgeCount = Object.values(normalized).reduce((sum, arr) => sum + arr.length, 0);
      return {
        ok: true,
        output: `[dispatch_graph] Registered ${Object.keys(normalized).length} dependency node(s), ${edgeCount} edge(s). Harness will sequence this round accordingly.`,
      };
    },
  });
}
