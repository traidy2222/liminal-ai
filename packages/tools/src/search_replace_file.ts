import { readFile, writeFile } from "node:fs/promises";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace } from "./file_path_guard.js";

export const searchReplaceFileTool = defineTool({
  name: "search_replace_file",
  description:
    "WHAT: Perform string or regex replacements inside one file.\n" +
    "WHEN: Targeted refactor/edit without full-file rewrite.",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`file:write:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path." },
      search: { type: "string", description: "Search pattern." },
      replace: { type: "string", description: "Replacement text." },
      regex: { type: "boolean", description: "Treat search as regex (default false)." },
      flags: { type: "string", description: "Regex flags when regex=true (default g)." },
      dry_run: { type: "boolean", description: "Return counts only without writing." },
    },
    required: ["path", "search", "replace"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid path" };
    const search = String(args["search"] ?? "");
    const replace = String(args["replace"] ?? "");
    const regex = Boolean(args["regex"]);
    const dryRun = Boolean(args["dry_run"]);
    const flags = String(args["flags"] ?? "g");
    const content = await readFile(safe.resolvedPath, "utf8");
    let next = content;
    let count = 0;
    if (regex) {
      const re = new RegExp(search, flags.includes("g") ? flags : `${flags}g`);
      const matches = content.match(re);
      count = matches?.length ?? 0;
      next = content.replace(re, replace);
    } else {
      count = content.split(search).length - 1;
      next = content.split(search).join(replace);
    }
    if (!dryRun && count > 0) await writeFile(safe.resolvedPath, next, "utf8");
    return {
      ok: true,
      output: `${dryRun ? "Preview" : "Applied"} replacements=${count} path=${safe.resolvedPath}`,
    };
  },
});

