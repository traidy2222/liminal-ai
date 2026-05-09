/**
 * ACON-style adaptive compression guidelines.
 *
 * When context compression is followed shortly by tool errors, a fast-model pass
 * identifies what information might have been lost and appends a "always preserve"
 * guideline to this file. Future compressions load these guidelines and inject them
 * into the compression policy preamble so the same information isn't lost again.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "./workspace_root.js";

const GUIDELINES_PATH = () =>
  join(resolveWorkspaceRoot(), ".agent_compression_guidelines.json");

interface GuidelinesFile {
  version: 1;
  guidelines: Array<{
    note: string;
    addedAt: string;
    triggerPattern?: string;
  }>;
}

async function loadGuidelines(): Promise<GuidelinesFile> {
  try {
    const raw = await readFile(GUIDELINES_PATH(), "utf8");
    const j = JSON.parse(raw) as GuidelinesFile;
    if (j.version !== 1 || !Array.isArray(j.guidelines)) {
      return { version: 1, guidelines: [] };
    }
    return j;
  } catch {
    return { version: 1, guidelines: [] };
  }
}

async function saveGuidelines(g: GuidelinesFile): Promise<void> {
  await writeFile(GUIDELINES_PATH(), JSON.stringify(g, null, 2), "utf8");
}

/**
 * Append a new "always preserve" guideline derived from a post-compression failure.
 * Deduplicates by note text (first 80 chars).
 */
export async function addCompressionGuideline(
  note: string,
  triggerPattern?: string
): Promise<void> {
  if (!note.trim()) return;
  try {
    const g = await loadGuidelines();
    const slug = note.trim().slice(0, 80);
    const exists = g.guidelines.some((x) => x.note.slice(0, 80) === slug);
    if (exists) return;
    g.guidelines.push({
      note: note.trim().slice(0, 400),
      addedAt: new Date().toISOString(),
      ...(triggerPattern ? { triggerPattern: triggerPattern.slice(0, 100) } : {}),
    });
    // Cap at 40 guidelines — oldest dropped first
    if (g.guidelines.length > 40) g.guidelines = g.guidelines.slice(-40);
    await saveGuidelines(g);
  } catch {
    /* non-fatal */
  }
}

/** Format all guidelines as a compression policy preamble string. */
export async function formatCompressionGuidelines(): Promise<string> {
  try {
    const g = await loadGuidelines();
    if (g.guidelines.length === 0) return "";
    const lines = g.guidelines
      .slice(-20)
      .map((x) => `  - ${x.note}`);
    return `Always preserve in summaries:\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}
