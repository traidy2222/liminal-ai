import { readFile } from "node:fs/promises";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace } from "./file_path_guard.js";

export const editPreviewTool = defineTool({
  name: "edit_preview",
  description:
    "WHAT: Preview proposed string/regex replacements without writing files.\n" +
    "WHEN: Before risky edits or bulk replacements.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path." },
      search: { type: "string", description: "Search pattern." },
      replace: { type: "string", description: "Replacement text." },
      regex: { type: "boolean", description: "Treat search as regex." },
      flags: { type: "string", description: "Regex flags (default g)." },
    },
    required: ["path", "search", "replace"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid path" };
    const content = await readFile(safe.resolvedPath, "utf8");
    const search = String(args["search"] ?? "");
    const replace = String(args["replace"] ?? "");
    const regex = Boolean(args["regex"]);
    const flags = String(args["flags"] ?? "g");
    let count = 0;
    let next = content;
    if (regex) {
      const re = new RegExp(search, flags.includes("g") ? flags : `${flags}g`);
      count = content.match(re)?.length ?? 0;
      next = content.replace(re, replace);
    } else {
      count = content.split(search).length - 1;
      next = content.split(search).join(replace);
    }
    const preview = next.slice(0, 1000);
    return {
      ok: true,
      output: JSON.stringify({ path: safe.resolvedPath, replacements: count, preview_chars: preview.length }, null, 2) + `\n\n${preview}`,
    };
  },
});

