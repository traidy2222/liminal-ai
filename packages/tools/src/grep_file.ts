/**
 * grep_file — search a single file for a pattern, return matches with N lines of
 * context. Equivalent to `grep -n -C N pattern file` but workspace-safe and with
 * structured output. Use this to locate the exact line of a bug/value before editing
 * with search_replace_file or apply_diff — avoids reading the whole file blind.
 */
import { readFile } from "node:fs/promises";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace } from "./file_path_guard.js";

export const grepFileTool = defineTool({
  name: "grep_file",
  description:
    "WHAT: Search a single file for a string or regex pattern; return matching lines with line numbers and surrounding context.\n" +
    "WHEN: You need to find the exact line of a bug, value, or block before editing. Faster and cheaper than reading the whole file.\n" +
    "NOT WHEN: Searching across many files — use find_references or ast_grep instead.\n" +
    "ARGS: path — file to search; pattern — string or regex; context_lines — lines of context around each match (default 3); regex — treat pattern as regex (default false); flags — regex flags (default 'i'); max_matches — cap results (default 20).",
  requiresApproval: false,
  dangerLevel: "safe",
  resourceLocks: () => [],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File to search (workspace-relative or absolute)." },
      pattern: { type: "string", description: "Text or regex pattern to find." },
      context_lines: {
        type: "number",
        description: "Lines of context above and below each match (default 3).",
      },
      regex: { type: "boolean", description: "Treat pattern as a regular expression (default false)." },
      flags: { type: "string", description: "Regex flags when regex=true (default 'i'). 'g' is always added." },
      max_matches: { type: "number", description: "Max number of match blocks to return (default 20)." },
    },
    required: ["path", "pattern"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid path" };

    const pattern = String(args["pattern"] ?? "");
    const contextLines = Math.max(0, Math.min(20, Number(args["context_lines"] ?? 3)));
    const useRegex = Boolean(args["regex"]);
    const maxMatches = Math.max(1, Math.min(100, Number(args["max_matches"] ?? 20)));
    const userFlags = String(args["flags"] ?? "i");

    let content: string;
    try {
      content = await readFile(safe.resolvedPath, "utf8");
    } catch (e) {
      return { ok: false, error: `Cannot read file: ${String(e)}` };
    }

    const lines = content.split("\n");

    // Build match predicate
    let testLine: (line: string) => boolean;
    if (useRegex) {
      let flags = userFlags;
      if (!flags.includes("g")) flags += "g";
      // We need a per-line test, use 'i' mode without 'g' for testing
      const testFlags = flags.replace("g", "") || "i";
      let re: RegExp;
      try {
        re = new RegExp(pattern, testFlags);
      } catch (e) {
        return { ok: false, error: `Invalid regex "${pattern}": ${String(e)}` };
      }
      testLine = (l) => re.test(l);
    } else {
      const lower = pattern.toLowerCase();
      testLine = (l) => l.toLowerCase().includes(lower);
    }

    // Collect matching line indices
    const matchIndices: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (testLine(lines[i]!)) matchIndices.push(i);
    }

    if (matchIndices.length === 0) {
      return {
        ok: true,
        output: `No matches for "${pattern}" in ${safe.resolvedPath} (${lines.length} lines total)`,
      };
    }

    // Merge overlapping context windows and cap
    const blocks: Array<{ start: number; end: number; matchLines: number[] }> = [];
    for (const idx of matchIndices) {
      const start = Math.max(0, idx - contextLines);
      const end = Math.min(lines.length - 1, idx + contextLines);
      const last = blocks[blocks.length - 1];
      if (last && start <= last.end + 1) {
        last.end = Math.max(last.end, end);
        last.matchLines.push(idx);
      } else {
        blocks.push({ start, end, matchLines: [idx] });
      }
      if (blocks.length >= maxMatches) break;
    }

    const totalMatches = matchIndices.length;
    const truncated = totalMatches > maxMatches;
    const parts: string[] = [
      `${totalMatches} match${totalMatches !== 1 ? "es" : ""} in ${safe.resolvedPath}${truncated ? ` (showing first ${maxMatches})` : ""}`,
    ];

    for (const block of blocks) {
      parts.push("---");
      for (let i = block.start; i <= block.end; i++) {
        const isMatch = block.matchLines.includes(i);
        const lineNum = String(i + 1).padStart(5);
        const marker = isMatch ? ">" : " ";
        parts.push(`${lineNum}${marker} ${lines[i]}`);
      }
    }

    return { ok: true, output: parts.join("\n") };
  },
});
