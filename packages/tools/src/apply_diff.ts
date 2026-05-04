/**
 * Apply a single-file unified diff with strict context matching.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "./helpers.js";

function parseHunkBody(lines: string[]): {
  oldStart: number;
  oldLines: string[];
  newLines: string[];
} | null {
  const header = lines[0] ?? "";
  const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!m) return null;
  const oldStart = parseInt(m[1]!, 10);
  const oldCount = m[2] ? parseInt(m[2], 10) : 1;
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i]!;
    if (L.startsWith("---") || L.startsWith("+++")) continue;
    if (L.startsWith("-")) oldLines.push(L.slice(1));
    else if (L.startsWith("+")) newLines.push(L.slice(1));
    else if (L.startsWith(" ") || L === "") {
      const body = L.startsWith(" ") ? L.slice(1) : "";
      oldLines.push(body);
      newLines.push(body);
    }
  }
  if (oldLines.length !== oldCount && oldCount !== 0) {
    /* tolerate fuzzy */
  }
  return { oldStart, oldLines, newLines };
}

export const applyDiffTool = defineTool({
  name: "apply_diff",
  description:
    "WHAT: Apply one unified-diff hunk to a single file (must match context lines exactly).\n" +
    "WHEN: You have a small patch in unified diff format with correct @@ header.\n" +
    "NOT WHEN: Multiple files in one diff — split per file.\n" +
    "ARGS: path — file; unified_diff — one-hunk unified diff body including @@ line.",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`file:write:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to patch" },
      unified_diff: { type: "string", description: "Unified diff (single hunk)" },
    },
    required: ["path", "unified_diff"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const filePath = path.resolve(resolveWorkspaceRoot(), args["path"] as string);
    const diffText = args["unified_diff"] as string;
    const chunks = diffText.split(/\n(?=@@)/);
    const hunkBlock = chunks.find((c) => c.trim().startsWith("@@")) ?? diffText;
    const hunkLines = hunkBlock.trim().split("\n");
    const parsed = parseHunkBody(hunkLines);
    if (!parsed) {
      return { ok: false, error: "Could not parse @@ hunk header in unified_diff" };
    }
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (e) {
      return { ok: false, error: `Cannot read file: ${String(e)}` };
    }
    const fileLines = content.split("\n");
    const idx0 = parsed.oldStart - 1;
    if (idx0 < 0 || idx0 > fileLines.length) {
      return { ok: false, error: `oldStart ${parsed.oldStart} out of range` };
    }
    const slice = fileLines.slice(idx0, idx0 + parsed.oldLines.length);
    if (slice.join("\n") !== parsed.oldLines.join("\n")) {
      return {
        ok: false,
        error:
          "Context mismatch — file content does not match diff old lines. Re-read file and rebuild diff.\n" +
          `Expected ${parsed.oldLines.length} lines at ${parsed.oldStart}, got mismatch.`,
      };
    }
    const next = [
      ...fileLines.slice(0, idx0),
      ...parsed.newLines,
      ...fileLines.slice(idx0 + parsed.oldLines.length),
    ].join("\n");
    try {
      await writeFile(filePath, next, "utf8");
    } catch (e) {
      return { ok: false, error: `Write failed: ${String(e)}` };
    }
    return { ok: true, output: `Patched ${filePath} (1 hunk)` };
  },
});
