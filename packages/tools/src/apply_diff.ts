/**
 * Apply a single-file unified diff with fuzzy context matching.
 *
 * Falls back gracefully when the model's remembered line numbers are wrong:
 * tries exact position first, then slides a ±SEARCH_RADIUS window looking
 * for the old-context lines. Reports the actual line used so the model can
 * update its mental model.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "./helpers.js";

const SEARCH_RADIUS = 120; // lines either side of stated oldStart to search

function parseHunkBody(lines: string[]): {
  oldStart: number;
  oldLines: string[];
  newLines: string[];
} | null {
  const header = lines[0] ?? "";
  const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!m) return null;
  const oldStart = parseInt(m[1]!, 10);
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i]!;
    if (L.startsWith("---") || L.startsWith("+++")) continue;
    if (L.startsWith("-")) oldLines.push(L.slice(1));
    else if (L.startsWith("+")) newLines.push(L.slice(1));
    else {
      // context line (space-prefixed or empty)
      const body = L.startsWith(" ") ? L.slice(1) : "";
      oldLines.push(body);
      newLines.push(body);
    }
  }
  return { oldStart, oldLines, newLines };
}

/**
 * Search for `needle` lines inside `haystack` lines.
 * Returns the 0-based start index where all needle lines match consecutively,
 * or -1 if not found. Searches the entire file (not just near hint).
 */
function findContext(haystack: string[], needle: string[], hint: number): number {
  if (needle.length === 0) return hint;

  // Build candidate positions: hint first, then expand outward
  const candidates: number[] = [];
  const lo = Math.max(0, hint - SEARCH_RADIUS);
  const hi = Math.min(haystack.length - needle.length, hint + SEARCH_RADIUS);

  // Priority: exact hint, then nearest-first outward
  candidates.push(hint);
  for (let d = 1; d <= SEARCH_RADIUS; d++) {
    if (hint - d >= lo) candidates.push(hint - d);
    if (hint + d <= hi) candidates.push(hint + d);
  }

  // Also scan the full file if not found in radius
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (!candidates.includes(i)) candidates.push(i);
  }

  for (const pos of candidates) {
    if (pos < 0 || pos + needle.length > haystack.length) continue;
    const slice = haystack.slice(pos, pos + needle.length);
    // Trim trailing whitespace when comparing to tolerate minor formatting
    if (slice.every((l, i) => l.trimEnd() === needle[i]!.trimEnd())) {
      return pos;
    }
  }
  return -1;
}

export const applyDiffTool = defineTool({
  name: "apply_diff",
  description:
    "WHAT: Apply one unified-diff hunk to a single file. Uses fuzzy context search so slightly wrong line numbers still work.\n" +
    "WHEN: Small precise structural edits — inserting, removing, or changing a block of lines.\n" +
    "PREFER search_replace_file for single-value swaps; batch_replace for bulk value changes across a file.\n" +
    "NOT WHEN: Multiple files in one diff — call once per file.\n" +
    "ARGS: path — file path; unified_diff — single hunk including @@ header.",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`file:write:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to patch." },
      unified_diff: {
        type: "string",
        description:
          "Unified diff — single hunk. Must include the @@ -old,count +new,count @@ header. " +
          "Context lines prefixed with space, removals with -, additions with +.",
      },
    },
    required: ["path", "unified_diff"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const filePath = path.resolve(resolveWorkspaceRoot(), args["path"] as string);
    const diffText = args["unified_diff"] as string;

    // Extract the hunk block (skip any leading --- +++ file headers)
    const chunks = diffText.split(/\n(?=@@)/);
    const hunkBlock = chunks.find((c) => c.trim().startsWith("@@")) ?? diffText;
    const hunkLines = hunkBlock.trim().split("\n");
    const parsed = parseHunkBody(hunkLines);
    if (!parsed) {
      return {
        ok: false,
        error:
          "Could not parse @@ hunk header. Ensure the diff starts with a line like:\n" +
          "  @@ -12,5 +12,7 @@\n" +
          "Received: " + (hunkLines[0] ?? "(empty)"),
      };
    }

    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (e) {
      return { ok: false, error: `Cannot read file: ${String(e)}` };
    }

    // Normalise line endings to LF for processing, remember original style
    const hasCRLF = content.includes("\r\n");
    const normalised = hasCRLF ? content.replace(/\r\n/g, "\n") : content;
    const fileLines = normalised.split("\n");

    // Separate context+removal lines (what must exist) from pure additions
    const contextLines = parsed.oldLines;
    const hint = parsed.oldStart - 1; // 0-based

    let matchIdx: number;

    if (contextLines.length === 0) {
      // Pure insertion — trust oldStart
      matchIdx = Math.max(0, Math.min(hint, fileLines.length));
    } else {
      matchIdx = findContext(fileLines, contextLines, hint);
      if (matchIdx === -1) {
        // Provide a diagnostic snippet around the stated position
        const snippetStart = Math.max(0, hint - 3);
        const snippet = fileLines.slice(snippetStart, snippetStart + 8).join("\n");
        return {
          ok: false,
          error:
            `Context mismatch — could not find the ${contextLines.length} old lines anywhere in the file (searched ±${SEARCH_RADIUS} lines from stated position ${parsed.oldStart}, then full file).\n` +
            `First old line to match: "${contextLines[0]}"\n` +
            `File content near stated line ${parsed.oldStart}:\n${snippet}\n` +
            "Re-read the relevant section and rebuild the diff.",
        };
      }
    }

    const appliedAt = matchIdx + 1; // 1-based for reporting
    const next = [
      ...fileLines.slice(0, matchIdx),
      ...parsed.newLines,
      ...fileLines.slice(matchIdx + contextLines.length),
    ].join("\n");

    const restored = hasCRLF ? next.replace(/\n/g, "\r\n") : next;
    try {
      await writeFile(filePath, restored, "utf8");
    } catch (e) {
      return { ok: false, error: `Write failed: ${String(e)}` };
    }

    const note =
      appliedAt !== parsed.oldStart
        ? ` (fuzzy: stated line ${parsed.oldStart}, matched at line ${appliedAt})`
        : "";
    return {
      ok: true,
      output: `Patched ${path.basename(filePath)} — 1 hunk at line ${appliedAt}${note}`,
    };
  },
});
