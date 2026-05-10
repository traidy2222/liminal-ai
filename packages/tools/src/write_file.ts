import { writeFile, mkdir, stat, access } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTool } from "./helpers.js";

export const writeFileTool = defineTool({
  name: "write_file",
  description:
    "WHAT: Create a NEW file with given content, creating parent directories as needed.\n" +
    "WHEN: The file does not exist yet and you have the complete content ready.\n" +
    "NOT WHEN: The file already exists — use edit_file instead (replacements, diff, or content+overwrite:true).\n" +
    "ARGS: path — destination file path; content — full text to write.",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`file:write:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to create" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const path = args["path"] as string;
    const content = args["content"] as string;
    // Guard: reject if file already exists — use edit_file for existing files
    try {
      await access(path);
      return {
        ok: false,
        error:
          `File already exists: ${path}\n` +
          "Use edit_file to modify an existing file:\n" +
          "  replacements: [{search, replace}]  — targeted string/regex swaps\n" +
          "  diff: '<hunk>'                      — unified diff patch\n" +
          "  content + overwrite:true            — full replacement (explicit)",
      };
    } catch {
      // File doesn't exist — proceed with creation
    }
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
      // Write-back verification: read file stats to confirm write succeeded
      try {
        const { size } = await stat(path);
        const preview = content.slice(0, 80).replace(/\n/g, "↵");
        return {
          ok: true,
          output:
            `Wrote ${content.length} chars to ${path} (${size} bytes on disk, verified ✓)\n` +
            `Preview: ${preview}${content.length > 80 ? "…" : ""}`,
        };
      } catch {
        // Write appeared to succeed but stat failed — report partial success
        return { ok: true, output: `Wrote ${content.length} chars to ${path} (verification stat failed — file may still be ok)` };
      }
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});
