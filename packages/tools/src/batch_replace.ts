/**
 * batch_replace — apply multiple find/replace pairs to a file in a single
 * read-modify-write cycle. Ideal for bulk value changes (colours, constants,
 * config values) in large files where a full rewrite would be wasteful and
 * risky. Each pair is applied sequentially to the running result so later
 * pairs can reference text introduced by earlier ones.
 */
import { readFile, writeFile } from "node:fs/promises";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace } from "./file_path_guard.js";

interface Replacement {
  search: string;
  replace: string;
  regex?: boolean;
  flags?: string;
}

export const batchReplaceTool = defineTool({
  name: "batch_replace",
  description:
    "WHAT: Apply multiple find/replace pairs to a single file in one atomic read-write.\n" +
    "WHEN: Changing many scattered values (colours, constants, config) without rewriting the whole file.\n" +
    "NOT WHEN: Structural code changes that alter line counts heavily — use apply_diff instead.\n" +
    "ARGS: path — target file; replacements — ordered array of {search, replace, regex?, flags?} pairs; dry_run — preview counts without writing.",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`file:write:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to edit." },
      replacements: {
        type: "array",
        description: "Ordered list of replacement operations.",
        items: {
          type: "object",
          properties: {
            search: { type: "string", description: "Text or regex pattern to find." },
            replace: { type: "string", description: "Replacement text (supports $1 back-refs when regex=true)." },
            regex: { type: "boolean", description: "Treat search as a regular expression." },
            flags: { type: "string", description: "Regex flags (default: 'g'). 'g' is always added." },
          },
          required: ["search", "replace"],
        },
      },
      dry_run: {
        type: "boolean",
        description: "Return match counts for each pair without writing.",
      },
    },
    required: ["path", "replacements"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid path" };

    const replacements = args["replacements"] as Replacement[];
    const dryRun = Boolean(args["dry_run"]);

    let content: string;
    try {
      content = await readFile(safe.resolvedPath, "utf8");
    } catch (e) {
      return { ok: false, error: `Cannot read file: ${String(e)}` };
    }

    const report: string[] = [];
    let current = content;

    for (let i = 0; i < replacements.length; i++) {
      const { search, replace, regex = false, flags = "g" } = replacements[i]!;
      let count = 0;
      if (regex) {
        let reFlags = flags;
        if (!reFlags.includes("g")) reFlags = reFlags + "g";
        let re: RegExp;
        try {
          re = new RegExp(search, reFlags);
        } catch (e) {
          report.push(`[${i}] ERROR invalid regex "${search}": ${String(e)}`);
          continue;
        }
        const matches = current.match(re);
        count = matches?.length ?? 0;
        current = current.replace(re, replace);
      } else {
        count = current.split(search).length - 1;
        current = current.split(search).join(replace);
      }
      report.push(`[${i}] "${search.slice(0, 60)}" → "${replace.slice(0, 60)}" : ${count} match${count !== 1 ? "es" : ""}`);
    }

    const changed = current !== content;
    if (!dryRun && changed) {
      try {
        await writeFile(safe.resolvedPath, current, "utf8");
      } catch (e) {
        return { ok: false, error: `Write failed: ${String(e)}` };
      }
    }

    return {
      ok: true,
      output: [
        dryRun ? "DRY RUN — no changes written" : changed ? `Written: ${safe.resolvedPath}` : "No changes (0 matches across all pairs)",
        ...report,
      ].join("\n"),
    };
  },
});
