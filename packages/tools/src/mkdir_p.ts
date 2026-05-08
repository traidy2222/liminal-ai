import { mkdir } from "node:fs/promises";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace } from "./file_path_guard.js";

export const mkdirPTool = defineTool({
  name: "mkdir_p",
  description: "WHAT: Create one or more directories recursively inside workspace.",
  requiresApproval: false,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      paths: { type: "array", items: { type: "string" }, description: "Directories to create." },
    },
    required: ["paths"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const paths = (args["paths"] as string[]) ?? [];
    const out: string[] = [];
    for (const p of paths) {
      const safe = resolveWithinWorkspace(p);
      if (!safe.ok || !safe.resolvedPath) {
        out.push(`${p}: blocked (${safe.error})`);
        continue;
      }
      await mkdir(safe.resolvedPath, { recursive: true });
      out.push(`${p}: created`);
    }
    return { ok: true, output: out.join("\n") || "(no paths)" };
  },
});

