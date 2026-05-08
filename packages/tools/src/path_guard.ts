import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace, existsAtPath } from "./file_path_guard.js";

export const pathGuardTool = defineTool({
  name: "path_guard",
  description:
    "WHAT: Validate one or more paths are inside workspace and optionally verify existence.\n" +
    "WHEN: Before write/move/copy operations where path safety matters.\n" +
    "ARGS: paths[] and optional require_exists.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Paths to validate against workspace root.",
      },
      require_exists: { type: "boolean", description: "If true, all paths must already exist." },
    },
    required: ["paths"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const paths = (args["paths"] as string[]) ?? [];
    const requireExists = Boolean(args["require_exists"]);
    const rows: string[] = [];
    for (const p of paths) {
      const safe = resolveWithinWorkspace(p);
      if (!safe.ok || !safe.resolvedPath) {
        rows.push(`${p} => blocked (${safe.error})`);
        continue;
      }
      if (requireExists && !(await existsAtPath(safe.resolvedPath))) {
        rows.push(`${p} => missing`);
        continue;
      }
      rows.push(`${p} => ok (${safe.resolvedPath})`);
    }
    return { ok: true, output: rows.join("\n") || "(no paths)" };
  },
});

