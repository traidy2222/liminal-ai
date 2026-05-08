import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "./helpers.js";

async function walk(dir: string, maxFiles: number, includeHidden: boolean, out: string[]): Promise<void> {
  if (out.length >= maxFiles) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!includeHidden && e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, maxFiles, includeHidden, out);
      if (out.length >= maxFiles) return;
    } else if (e.isFile()) {
      out.push(full);
      if (out.length >= maxFiles) return;
    }
  }
}

export const workspaceSnapshotTool = defineTool({
  name: "workspace_snapshot",
  description:
    "WHAT: Capture deterministic snapshot of workspace files with metadata hashes.\n" +
    "WHEN: Drift detection, verification, and long-horizon checkpoints.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      max_files: { type: "number", description: "Maximum files to include (default 200)." },
      include_hidden: { type: "boolean", description: "Include hidden files (default false)." },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const root = path.resolve(resolveWorkspaceRoot());
    const maxFiles = Math.max(1, Math.min(5000, Number(args["max_files"] ?? 200) || 200));
    const includeHidden = Boolean(args["include_hidden"]);
    try {
      const files: string[] = [];
      await walk(root, maxFiles, includeHidden, files);
      files.sort();
      const rows: Array<{ path: string; size: number; mtime: string; quick_hash: string }> = [];
      for (const f of files) {
        const s = await stat(f);
        const rel = path.relative(root, f);
        const quick = crypto.createHash("sha1").update(`${rel}:${s.size}:${s.mtimeMs}`).digest("hex");
        rows.push({ path: rel, size: s.size, mtime: s.mtime.toISOString(), quick_hash: quick });
      }
      return { ok: true, output: JSON.stringify({ root, file_count: rows.length, files: rows }, null, 2) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});

