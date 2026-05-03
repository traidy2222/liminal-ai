import { writeFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { defineTool } from "./helpers.js";

export const writeFileTool = defineTool({
  name: "write_file",
  description:
    "WHAT: Write (or overwrite) a file with new content, creating parent directories as needed.\n" +
    "WHEN: You have the complete final content ready to persist.\n" +
    "NOT WHEN: Making a small edit to an existing file — read it first, merge the change, then write the merged result.\n" +
    "ARGS: path — destination file path; content — full text to write.",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`file:write:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const path = args["path"] as string;
    const content = args["content"] as string;
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
