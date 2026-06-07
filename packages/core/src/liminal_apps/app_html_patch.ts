/**
 * edit_file-style patches for persisted widget HTML (~/.liminal/apps/html/).
 */

export interface TextReplacement {
  search: string;
  replace: string;
  regex?: boolean;
  flags?: string;
}

export interface HtmlEditInput {
  replacements?: TextReplacement[];
  diff?: string;
}

export interface HtmlEditResult {
  content: string;
  report: string[];
  changed: boolean;
}

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

export function applyTextReplacements(
  rawContent: string,
  replacements: TextReplacement[]
): HtmlEditResult {
  const report: string[] = [];
  let current = rawContent;

  for (let i = 0; i < replacements.length; i++) {
    const { search, replace, regex = false, flags = "g" } = replacements[i]!;
    if (search === replace) {
      report.push(`[${i}] SKIPPED: search and replace are identical`);
      continue;
    }
    let count = 0;
    if (regex) {
      const reFlags = flags.includes("g") ? flags : flags + "g";
      let re: RegExp;
      try {
        re = new RegExp(search, reFlags);
      } catch (e) {
        report.push(`[${i}] ERROR invalid regex: ${String(e)}`);
        continue;
      }
      count = current.match(re)?.length ?? 0;
      current = current.replace(re, replace);
    } else {
      count = current.split(search).length - 1;
      current = current.split(search).join(replace);
    }
    report.push(
      `[${i}] "${search.slice(0, 60)}" → "${replace.slice(0, 60)}" : ${count} match${count !== 1 ? "es" : ""}`
    );
  }

  return { content: current, report, changed: current !== rawContent };
}

export function applyUnifiedDiffHunk(rawContent: string, diffText: string): HtmlEditResult {
  const chunks = diffText.split(/\n(?=@@)/);
  const hunkBlock = chunks.find((c) => c.trim().startsWith("@@")) ?? diffText;
  const hunkLines = hunkBlock.trim().split("\n");
  const parsed = parseHunk(hunkLines);
  if (!parsed) {
    return {
      content: rawContent,
      report: ["ERROR: Could not parse @@ hunk header"],
      changed: false,
    };
  }

  const hasCRLF = rawContent.includes("\r\n");
  const normalised = hasCRLF ? rawContent.replace(/\r\n/g, "\n") : rawContent;
  const lines = normalised.split("\n");
  const pos = findContext(lines, parsed.oldLines, parsed.oldStart - 1);
  if (pos < 0) {
    return {
      content: rawContent,
      report: ["ERROR: Could not locate diff context in widget HTML"],
      changed: false,
    };
  }
  const next = [...lines.slice(0, pos), ...parsed.newLines, ...lines.slice(pos + parsed.oldLines.length)];
  const joined = next.join("\n");
  const content = hasCRLF ? joined.replace(/\n/g, "\r\n") : joined;
  return {
    content,
    report: [`Applied diff hunk at line ~${pos + 1} (${parsed.oldLines.length} → ${parsed.newLines.length} lines)`],
    changed: content !== rawContent,
  };
}

export function applyHtmlEdit(rawContent: string, input: HtmlEditInput): HtmlEditResult {
  const hasReplacements = Array.isArray(input.replacements) && input.replacements.length > 0;
  const hasDiff = typeof input.diff === "string" && input.diff.trim().length > 0;
  if (hasReplacements && hasDiff) {
    return {
      content: rawContent,
      report: ["ERROR: Provide exactly one of replacements or diff"],
      changed: false,
    };
  }
  if (hasReplacements) {
    return applyTextReplacements(rawContent, input.replacements!);
  }
  if (hasDiff) {
    return applyUnifiedDiffHunk(rawContent, input.diff!);
  }
  return {
    content: rawContent,
    report: ["ERROR: Provide replacements or diff"],
    changed: false,
  };
}

export function grepAppHtmlLines(
  content: string,
  pattern: string,
  opts: { regex?: boolean; flags?: string; contextLines?: number } = {}
): string {
  const lines = content.split("\n");
  const context = Math.max(0, Math.min(8, opts.contextLines ?? 2));
  const hits: string[] = [];
  let re: RegExp | null = null;
  if (opts.regex) {
    try {
      re = new RegExp(pattern, opts.flags ?? "i");
    } catch (e) {
      return `Invalid regex: ${String(e)}`;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = re ? re.test(line) : line.includes(pattern);
    if (!match) continue;
    const start = Math.max(0, i - context);
    const end = Math.min(lines.length - 1, i + context);
    hits.push(`--- match at line ${i + 1} ---`);
    for (let j = start; j <= end; j++) {
      const prefix = j === i ? ">" : " ";
      hits.push(`${prefix}${String(j + 1).padStart(5)}| ${lines[j]}`);
    }
  }
  if (hits.length === 0) return "(no matches)";
  return hits.join("\n");
}

export function readAppHtmlSlice(
  content: string,
  opts: { startLine?: number; endLine?: number; maxChars?: number } = {}
): string {
  const lines = content.split("\n");
  const start = Math.max(1, opts.startLine ?? 1);
  const end = Math.min(lines.length, opts.endLine ?? lines.length);
  const slice = lines.slice(start - 1, end);
  let out = slice.map((l, i) => `${String(start + i).padStart(5)}| ${l}`).join("\n");
  const max = opts.maxChars ?? 24_000;
  if (out.length > max) {
    out = out.slice(0, max) + `\n… truncated (${out.length} chars, showing first ${max})`;
  }
  return out || "(empty widget HTML)";
}
