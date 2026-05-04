import { defineTool } from "./helpers.js";
import { gatherRepoMapLines } from "@liminal/core";

export const repoMapTool = defineTool({
  name: "repo_map",
  description:
    "WHAT: Return a compact shallow tree of the repo (default: ./packages two levels) without many list_dir calls.\n" +
    "WHEN: Orienting at session start or tracing architecture — prefer this over repeated list_dir at repo root.\n" +
    "ARGS: scope — 'packages' (default) or 'root' for depth-1 cwd listing.",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 120_000,
  parameters: {
    type: "object",
    properties: {
      scope: {
        type: "string",
        enum: ["packages", "root"],
        description: "packages (default) or root",
      },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const scope = (args["scope"] as string | undefined) === "root" ? "root" : "packages";
    const lines = await gatherRepoMapLines({ scope });
    return { ok: true, output: lines.join("\n") };
  },
});
