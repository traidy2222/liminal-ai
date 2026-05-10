/**
 * edit_file — unified tool for all edits to EXISTING files.
 *
 * Three modes, pick exactly one:
 *   replacements  — one or more find/replace pairs (like old batch_replace/search_replace_file)
 *   diff          — unified diff hunk with fuzzy context matching (like old apply_diff)
 *   content       — full file replacement; requires overwrite:true (escape hatch for genuine rewrites)
 *
 * write_file is for NEW files only. edit_file is for everything else.
 */
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "./helpers.js";
import { resolveWithinWorkspace } from "./file_path_guard.js";

// ─── Fuzzy diff helpers (same algorithm as apply_diff.ts) ────────────────────

const SEARCH_RADIUS = 120;

interface ParsedHunk {
  oldStart: number;
  oldLines: string[];
  newLines: string[];
}

function parseHunk(lines: string[]): ParsedHunk | null {
  const header = lines[0] ?? "";
  const m = header.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/);
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
      const body = L.startsWith(" ") ? L.slice(1) : "";
      oldLines.push(body);
      newLines.push(body);
    }
  }
  return { oldStart, oldLines, newLines };
}

function findContext(haystack: string[], needle: string[], hint: number): number {
  if (needle.length === 0) return hint;
  const lo = Math.max(0, hint - SEARCH_RADIUS);
  const hi = Math.min(haystack.length - needle.length, hint + SEARCH_RADIUS);
  const candidates: number[] = [hint];
  for (let d = 1; d <= SEARCH_RADIUS; d++) {
    if (hint - d >= lo) candidates.push(hint - d);
    if (hint + d <= hi) candidates.push(hint + d);
  }
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (!candidates.includes(i)) candidates.push(i);
  }
  for (const pos of candidates) {
    if (pos < 0 || pos + needle.length > haystack.length) continue;
    if (haystack.slice(pos, pos + needle.length).every((l, i) => l.trimEnd() === needle[i]!.trimEnd())) {
      return pos;
    }
  }
  return -1;
}

// ─── Tool definition ─────────────────────────────────────────────────────────

interface Replacement {
  search: string;
  replace: string;
  regex?: boolean;
  flags?: string;
}

export const editFileTool = defineTool({
  name: "edit_file",
  description:
    "WHAT: Edit an EXISTING file. Three modes — pick exactly one:\n" +
    "  replacements: [{search, replace, regex?, flags?}]  — find/replace one or many strings in one write.\n" +
    "  diff: '<unified diff hunk>'                        — patch via @@ hunk; fuzzy search finds context even if line numbers are slightly off.\n" +
    "  content: '<full text>' + overwrite:true            — full replacement (escape hatch; requires explicit overwrite:true).\n" +
    "WHEN: Any targeted change to a file that already exists.\n" +
    "NOT WHEN: Creating a brand-new file — use write_file instead.\n" +
    "WORKFLOW: grep_file first to find the exact line, then edit_file with replacements to fix it.",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`file:write:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the existing file to edit.",
      },
      replacements: {
        type: "array",
        description:
          "One or more find/replace pairs applied in order in a single read-write. " +
          "Use this for 1–N targeted string or regex swaps.",
        items: {
          type: "object",
          properties: {
            search: { type: "string" },
            replace: { type: "string" },
            regex: { type: "boolean" },
            flags: { type: "string", description: "Regex flags (default 'g'). 'g' is always added." },
          },
          required: ["search", "replace"],
        },
      },
      diff: {
        type: "string",
        description:
          "Unified diff hunk including the @@ header. " +
          "Context lines prefixed with space, removals with -, additions with +. " +
          "Line numbers can be approximate — fuzzy search finds the right location.",
      },
      content: {
        type: "string",
        description: "Full replacement content. Requires overwrite:true — this rewrites the entire file.",
      },
      overwrite: {
        type: "boolean",
        description: "Must be true when using content mode to confirm intentional full replacement.",
      },
      preview: {
        type: "boolean",
        description: "Dry run — report what would change without writing.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },

  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid path" };
    const filePath = safe.resolvedPath;
    const preview = Boolean(args["preview"]);

    // ── Verify file exists ───────────────────────────────────────────────────
    try {
      await access(filePath);
    } catch {
      return {
        ok: false,
        error:
          `File does not exist: ${filePath}\n` +
          "Use write_file to create a new file.",
      };
    }

    const hasReplacements = Array.isArray(args["replacements"]) && (args["replacements"] as Replacement[]).length > 0;
    const hasDiff = typeof args["diff"] === "string" && (args["diff"] as string).trim().length > 0;
    const hasContent = typeof args["content"] === "string";

    const modeCount = [hasReplacements, hasDiff, hasContent].filter(Boolean).length;
    if (modeCount === 0) {
      return { ok: false, error: "Provide exactly one of: replacements, diff, or content." };
    }
    if (modeCount > 1) {
      return { ok: false, error: "Provide exactly one of: replacements, diff, or content — not multiple." };
    }

    // ── MODE: full content replacement ───────────────────────────────────────
    if (hasContent) {
      if (args["overwrite"] !== true) {
        return {
          ok: false,
          error:
            "Content mode replaces the entire file. Set overwrite:true to confirm.\n" +
            "Tip: for targeted edits use replacements or diff instead — they are safer and faster.",
        };
      }
      const newContent = args["content"] as string;
      if (preview) {
        return { ok: true, output: `PREVIEW — would write ${newContent.length} chars to ${filePath}` };
      }
      try {
        await writeFile(filePath, newContent, "utf8");
        return { ok: true, output: `Wrote ${newContent.length} chars to ${filePath} (full replacement)` };
      } catch (e) {
        return { ok: false, error: `Write failed: ${String(e)}` };
      }
    }

    // ── Read file for replacement/diff modes ─────────────────────────────────
    let rawContent: string;
    try {
      rawContent = await readFile(filePath, "utf8");
    } catch (e) {
      return { ok: false, error: `Cannot read file: ${String(e)}` };
    }

    // ── MODE: replacements ───────────────────────────────────────────────────
    if (hasReplacements) {
      const replacements = args["replacements"] as Replacement[];
      const report: string[] = [];
      let current = rawContent;

      for (let i = 0; i < replacements.length; i++) {
        const { search, replace, regex = false, flags = "g" } = replacements[i]!;
        let count = 0;
        if (regex) {
          let reFlags = flags.includes("g") ? flags : flags + "g";
          let re: RegExp;
          try {
            re = new RegExp(search, reFlags);
          } catch (e) {
            report.push(`[${i}] ERROR invalid regex "${search}": ${String(e)}`);
            continue;
          }
          count = current.match(re)?.length ?? 0;
          current = current.replace(re, replace);
        } else {
          count = current.split(search).length - 1;
          current = current.split(search).join(replace);
        }
        report.push(`[${i}] "${search.slice(0, 60)}" → "${replace.slice(0, 60)}" : ${count} match${count !== 1 ? "es" : ""}`);
      }

      const changed = current !== rawContent;
      if (preview || !changed) {
        return {
          ok: true,
          output: [
            preview ? "PREVIEW — no changes written" : "No changes (0 matches across all pairs)",
            ...report,
          ].join("\n"),
        };
      }
      try {
        await writeFile(filePath, current, "utf8");
      } catch (e) {
        return { ok: false, error: `Write failed: ${String(e)}` };
      }
      return { ok: true, output: [`Written: ${filePath}`, ...report].join("\n") };
    }

    // ── MODE: diff ───────────────────────────────────────────────────────────
    const diffText = args["diff"] as string;
    const chunks = diffText.split(/\n(?=@@)/);
    const hunkBlock = chunks.find((c) => c.trim().startsWith("@@")) ?? diffText;
    const hunkLines = hunkBlock.trim().split("\n");
    const parsed = parseHunk(hunkLines);
    if (!parsed) {
      return {
        ok: false,
        error:
          "Could not parse @@ hunk header. Diff must start with a line like:\n" +
          "  @@ -12,5 +12,7 @@\n" +
          "Received: " + (hunkLines[0] ?? "(empty)"),
      };
    }

    const hasCRLF = rawContent.includes("\r\n");
    const normalised = hasCRLF ? rawContent.replace(/\r\n/g, "\n") : rawContent;
    const fileLines = normalised.split("\n");
    const hint = parsed.oldStart - 1;

    let matchIdx: number;
    if (parsed.oldLines.length === 0) {
      matchIdx = Math.max(0, Math.min(hint, fileLines.length));
    } else {
      matchIdx = findContext(fileLines, parsed.oldLines, hint);
      if (matchIdx === -1) {
        const snippetStart = Math.max(0, hint - 3);
        const snippet = fileLines.slice(snippetStart, snippetStart + 8).join("\n");
        return {
          ok: false,
          error:
            `Context mismatch — could not find the ${parsed.oldLines.length} old lines (searched ±${SEARCH_RADIUS} lines from stated position ${parsed.oldStart}, then full file).\n` +
            `First line to match: "${parsed.oldLines[0]}"\n` +
            `File content near stated line ${parsed.oldStart}:\n${snippet}\n` +
            "Use grep_file to find the exact line, then rebuild the diff.",
        };
      }
    }

    const appliedAt = matchIdx + 1;
    const nextLines = [
      ...fileLines.slice(0, matchIdx),
      ...parsed.newLines,
      ...fileLines.slice(matchIdx + parsed.oldLines.length),
    ];
    const nextContent = (hasCRLF ? nextLines.join("\r\n") : nextLines.join("\n"));

    if (preview) {
      const note = appliedAt !== parsed.oldStart ? ` (fuzzy: stated ${parsed.oldStart}, matched ${appliedAt})` : "";
      return { ok: true, output: `PREVIEW — would apply hunk at line ${appliedAt}${note}` };
    }

    try {
      await writeFile(filePath, nextContent, "utf8");
    } catch (e) {
      return { ok: false, error: `Write failed: ${String(e)}` };
    }

    const note = appliedAt !== parsed.oldStart ? ` (fuzzy: stated line ${parsed.oldStart}, matched at line ${appliedAt})` : "";
    return { ok: true, output: `Patched ${path.basename(filePath)} — 1 hunk at line ${appliedAt}${note}` };
  },
});
