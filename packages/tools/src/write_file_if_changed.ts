import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import crypto from "node:crypto";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace } from "./file_path_guard.js";

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export const writeFileIfChangedTool = defineTool({
  name: "write_file_if_changed",
  description:
    "WHAT: Write file only if content differs from current disk content.\n" +
    "WHEN: Idempotent generation and low-noise updates.",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`file:write:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Destination path." },
      content: { type: "string", description: "Full content to write." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid path" };
    const content = String(args["content"] ?? "");
    let existing = "";
    let existed = false;
    try {
      existing = await readFile(safe.resolvedPath, "utf8");
      existed = true;
    } catch {
      existed = false;
    }
    if (existed && existing === content) {
      return { ok: true, output: `No change: ${safe.resolvedPath} (sha256 ${hashContent(content).slice(0, 12)})` };
    }
    await mkdir(dirname(safe.resolvedPath), { recursive: true });
    await writeFile(safe.resolvedPath, content, "utf8");
    return {
      ok: true,
      output:
        `${existed ? "Updated" : "Created"} ${safe.resolvedPath}\n` +
        `old_sha=${existed ? hashContent(existing).slice(0, 12) : "none"} new_sha=${hashContent(content).slice(0, 12)}`,
    };
  },
});

