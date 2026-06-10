/**
 * restore_memory — recover a soft-deleted note from the archive.
 *
 * Counterpart to the archiving done by `forget` and `curate_memory`. Re-inserts
 * the most recent archived value for a key (refusing to clobber a live key) and
 * drops that row from the archive. See notes_archive.ts.
 */
import { defineTool } from "../../shared/helpers.js";
import { restoreArchivedNote, listArchive } from "./notes_archive.js";

export const restoreMemoryTool = defineTool({
  name: "restore_memory",
  description:
    "WHAT: Restore a note that was soft-deleted by forget/curate_memory back into the store.\n" +
    "WHEN: A prune was wrong, or you need a removed memory back. Pass no key to list recent archived entries.\n" +
    "NOT WHEN: The note still exists — restore won't overwrite a live key.\n" +
    "ARGS: key — exact archived key to restore. list — if true (or key omitted), show recent archived entries instead.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Exact original key to restore from the archive." },
      list: { type: "boolean", description: "List recent archived entries instead of restoring." },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args) => {
    const key = String(args["key"] ?? "").trim();
    if (!key || args["list"] === true) {
      const rows = await listArchive(50);
      if (rows.length === 0) return { ok: true, output: "Archive is empty." };
      const lines = rows.map(
        (r) => `- [${r.originalKey}] archived ${r.archivedAt.slice(0, 19)} (${r.reason}): ${r.value.replace(/\s+/g, " ").slice(0, 80)}`
      );
      return { ok: true, output: `${rows.length} archived note(s) (newest first):\n${lines.join("\n")}` };
    }
    const res = await restoreArchivedNote(key);
    return res.ok ? { ok: true, output: res.message } : { ok: false, error: res.message };
  },
});
