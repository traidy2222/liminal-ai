/**
 * patch_file — apply exact string replacements to a file without full overwrite.
 *
 * Safer and less context-hungry than read→mutate→write_file for large files.
 * Fails fast if any search string is not found (no silent misses).
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineTool } from "./helpers.js";

export const patchFileTool = defineTool({
  name: "patch_file",
  description:
    "WHAT: Apply one or more exact string replacements to a file in place.\n" +
    "WHEN: Editing a large file where you know exactly what to change — safer than full overwrite.\n" +
    "NOT WHEN: The change spans many non-contiguous locations or you need to rewrite the whole file.\n" +
    "ARGS: path — file to patch; patches — ordered list of { search, replace } pairs.\n" +
    "IMPORTANT: search strings must be exact and unique within the file. " +
    "The tool fails if any search string is not found or appears more than once.",
  requiresApproval: false,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`file:write:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative path to the file" },
      patches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            search: { type: "string", description: "Exact string to find in the file" },
            replace: { type: "string", description: "Replacement string" },
          },
          required: ["search", "replace"],
        },
        description: "Ordered list of search→replace operations",
      },
    },
    required: ["path", "patches"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const filePath = resolve(args["path"] as string);
    const patches = args["patches"] as Array<{ search: string; replace: string }>;

    if (patches.length === 0) {
      return { ok: false, error: "No patches provided." };
    }

    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (err) {
      return { ok: false, error: `Cannot read file: ${String(err)}` };
    }

    const applied: string[] = [];
    for (let i = 0; i < patches.length; i++) {
      const { search, replace } = patches[i]!;
      const count = content.split(search).length - 1;

      if (count === 0) {
        return {
          ok: false,
          error:
            `Patch ${i + 1}/${patches.length} failed: search string not found in file.\n` +
            `Search (first 80 chars): ${search.slice(0, 80)}${search.length > 80 ? "…" : ""}`,
        };
      }
      if (count > 1) {
        return {
          ok: false,
          error:
            `Patch ${i + 1}/${patches.length} failed: search string appears ${count} times — must be unique.\n` +
            `Provide more surrounding context to make it unique.\n` +
            `Search (first 80 chars): ${search.slice(0, 80)}${search.length > 80 ? "…" : ""}`,
        };
      }

      content = content.replace(search, replace);
      applied.push(`  ${i + 1}. Replaced ${search.length} chars → ${replace.length} chars`);
    }

    try {
      await writeFile(filePath, content, "utf8");
    } catch (err) {
      return { ok: false, error: `Write failed: ${String(err)}` };
    }

    return {
      ok: true,
      output: `Applied ${patches.length} patch${patches.length === 1 ? "" : "es"} to ${filePath}\n${applied.join("\n")}`,
    };
  },
});
