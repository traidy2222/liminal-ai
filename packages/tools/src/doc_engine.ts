import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceRoot, type DocumentIR, type DocChunk, type DocQualityReport, type DocStyleGenome, type BulletItem } from "@liminal/core";

/** Extract display text from a BulletItem (plain string or emphasis object). */
export function getBulletText(b: BulletItem): string {
  return typeof b === "string" ? b : b.text;
}

export type DocFormat = "pptx" | "docx" | "pdf";

export function sourceQualityForRef(ref: string): "official" | "primary" | "secondary" {
  const t = ref.toLowerCase();
  if (/imf\.org|adb\.org|worldbank\.org|oecd\.org|gov\.|rba\.gov\.au|boj\.or\.jp|data\.|statista\.com/.test(t)) {
    return "official";
  }
  if (/reuters|bloomberg|spglobal|weforum|mckinsey|bain|bcg/.test(t)) {
    return "primary";
  }
  return "secondary";
}

function exportsRoot(): string {
  return join(resolveWorkspaceRoot(), ".agent_artifacts", "exports");
}

export function irPath(docId: string): string {
  return join(exportsRoot(), `${docId}.ir.json`);
}

export function exportPath(docId: string, format: DocFormat): string {
  return join(exportsRoot(), `${docId}.${format}`);
}

export function manifestPath(docId: string): string {
  return join(exportsRoot(), `${docId}.manifest.json`);
}

export function bundleDir(docId: string): string {
  return join(exportsRoot(), docId);
}

export async function ensureDocDirs(): Promise<void> {
  await mkdir(exportsRoot(), { recursive: true });
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function hexFromSeed(seed: string, salt: string): string {
  let h = 5381;
  const txt = `${seed}:${salt}`;
  for (let i = 0; i < txt.length; i++) h = ((h << 5) + h) ^ txt.charCodeAt(i);
  const v = (h >>> 0).toString(16).padStart(8, "0");
  return `#${v.slice(0, 6)}`;
}

function pickFromSeed<T>(seed: string, salt: string, options: T[]): T {
  let h = 0;
  const txt = `${seed}:${salt}`;
  for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) >>> 0;
  return options[h % options.length]!;
}

export function synthesizeStyleGenome(seed: string): DocStyleGenome {
  const theme = pickFromSeed(seed, "theme", [
    { background: "#0B1020", foreground: "#F3F5FA", accent: "#7C8CFF", muted: "#AAB4D6" },
    { background: "#111827", foreground: "#F9FAFB", accent: "#22D3EE", muted: "#9CA3AF" },
    { background: "#0F172A", foreground: "#E2E8F0", accent: "#38BDF8", muted: "#94A3B8" },
    { background: "#131A2A", foreground: "#F8FAFC", accent: "#8B5CF6", muted: "#A1A1AA" },
    { background: "#08151F", foreground: "#E6F4FF", accent: "#00C2A8", muted: "#89A3B2" },
  ]);
  const heading = pickFromSeed(seed, "heading", ["Aptos Display", "Segoe UI", "Calibri"]);
  const body = pickFromSeed(seed, "body", ["Aptos", "Segoe UI", "Calibri"]);
  const accentOverride = hexFromSeed(seed, "accent-modern");
  return {
    id: `style-${slug(seed)}-${Date.now().toString(36)}`,
    seed,
    description: undefined,
    palette: {
      background: theme.background,
      foreground: theme.foreground,
      accent: accentOverride.startsWith("#00") ? theme.accent : accentOverride,
      muted: theme.muted,
    },
    typography: {
      heading,
      body,
      mono: "Cascadia Code",
      scale: [48, 34, 24, 17, 12],
    },
    spacing: { base: 10, rhythm: 1.6 },
    chart: { strokeWidth: 2, cornerRadius: 10, labelDensity: "med" as const },
  };
}

export async function saveStyleSignature(docId: string, style: DocumentIR["style"]): Promise<void> {
  await ensureDocDirs();
  const p = join(exportsRoot(), ".style_memory.json");
  let rows: Array<{ docId: string; styleId: string; palette: string; at: string }> = [];
  try {
    rows = JSON.parse(await readFile(p, "utf8")) as typeof rows;
  } catch {
    rows = [];
  }
  rows.push({
    docId,
    styleId: style.id,
    palette: `${style.palette.background}|${style.palette.foreground}|${style.palette.accent}|${style.palette.muted}`,
    at: new Date().toISOString(),
  });
  rows = rows.slice(-80);
  await writeFile(p, JSON.stringify(rows, null, 2), "utf8");
}

export function buildInitialChunks(outline: string[]): DocChunk[] {
  return outline.map((title, i) => ({
    id: `chunk-${i + 1}`,
    title,
    intent: "slide",
    bullets: [],
    status: "planned",
  }));
}

export async function saveIR(doc: DocumentIR): Promise<void> {
  await ensureDocDirs();
  await writeFile(irPath(doc.id), JSON.stringify(doc, null, 2), "utf8");
}

export function ensureRunState(doc: DocumentIR): NonNullable<DocumentIR["runState"]> {
  if (!doc.runState) {
    const budget = Math.max(1, parseInt(process.env["AGENT_DOC_REPAIR_BUDGET"] ?? "4", 10) || 4);
    doc.runState = {
      stage: "planned",
      retries: 0,
      failures: 0,
      warnings: [],
      repairBudget: { max: budget, used: 0 },
      stageTrace: [{ at: new Date().toISOString(), stage: "planned", note: "initialized" }],
    };
  }
  return doc.runState;
}

export function setRunStage(doc: DocumentIR, stage: NonNullable<DocumentIR["runState"]>["stage"], note?: string): void {
  const rs = ensureRunState(doc);
  rs.stage = stage;
  rs.stageTrace.push({ at: new Date().toISOString(), stage, note });
}

export async function loadIR(docId: string): Promise<DocumentIR> {
  const raw = await readFile(irPath(docId), "utf8");
  return JSON.parse(raw) as DocumentIR;
}

export function lintChunk(chunk: DocChunk): string[] {
  const issues: string[] = [];
  if (!chunk.title.trim()) issues.push("missing_title");
  if (chunk.bullets.length === 0 && !chunk.narrative?.trim() && !chunk.slide_body?.trim()) issues.push("missing_content");
  if (chunk.bullets.length > 8) issues.push("bullet_overflow");
  for (const b of chunk.bullets) {
    if (getBulletText(b).length > 140) issues.push("bullet_too_long");
  }
  if (chunk.narrative && chunk.narrative.length > 500) issues.push("narrative_too_long");
  if (chunk.slide_body && chunk.slide_body.length > 300) issues.push("slide_body_too_long");
  return [...new Set(issues)];
}

export function repairChunk(chunk: DocChunk): { chunk: DocChunk; action: string } {
  const next: DocChunk = { ...chunk, bullets: [...chunk.bullets] };
  let action = "none";
  if (next.bullets.length > 8) {
    next.bullets = next.bullets.slice(0, 8);
    action = "trimmed_bullets_to_8";
  }
  next.bullets = next.bullets.map((b) => {
    const text = getBulletText(b);
    if (text.length > 140) {
      const trimmed = `${text.slice(0, 137)}...`;
      return typeof b === "string" ? trimmed : { ...b, text: trimmed };
    }
    return b;
  });
  if (action === "none" && next.bullets.some((b) => getBulletText(b).endsWith("..."))) {
    action = "trimmed_long_bullets";
  }
  if (next.slide_body && next.slide_body.length > 300) {
    next.slide_body = `${next.slide_body.slice(0, 297)}...`;
    if (action === "none") action = "trimmed_slide_body";
  }
  if (next.bullets.length === 0 && !next.narrative?.trim() && !next.slide_body?.trim()) {
    next.bullets = ["Add supporting point", "Add evidence", "Add next action"];
    action = "seeded_default_bullets";
  }
  next.status = "repaired";
  next.lintIssues = [];
  return { chunk: next, action };
}

export function computeStyleDistance(a: DocumentIR["style"], b: DocumentIR["style"]): number {
  const x = `${a.palette.background}${a.palette.foreground}${a.palette.accent}${a.palette.muted}`;
  const y = `${b.palette.background}${b.palette.foreground}${b.palette.accent}${b.palette.muted}`;
  let same = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] === y[i]) same += 1;
  return 1 - same / Math.max(x.length, y.length, 1);
}

export async function loadRecentIR(limit = 6): Promise<DocumentIR[]> {
  await ensureDocDirs();
  const fs = await import("node:fs/promises");
  const entries = await fs.readdir(exportsRoot(), { withFileTypes: true });
  const irFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".ir.json"))
    .map((e) => join(exportsRoot(), e.name));
  const docs: DocumentIR[] = [];
  for (const p of irFiles.slice(-limit)) {
    try {
      const raw = await readFile(p, "utf8");
      docs.push(JSON.parse(raw) as DocumentIR);
    } catch {
      // ignore bad files
    }
  }
  return docs;
}

export function scoreQuality(doc: DocumentIR): DocQualityReport {
  const total = Math.max(1, doc.chunks.length);
  const lintFailures = doc.chunks.filter((c) => (c.lintIssues?.length ?? 0) > 0).length;
  const rendered = doc.chunks.filter((c) => c.status === "rendered").length;
  const structureFidelity = Math.max(0, 100 - lintFailures * (100 / total));
  const visualConsistency = Math.max(0, 85 + Math.min(15, rendered * 2) - lintFailures * 3);
  const readabilityDensity = Math.max(0, 92 - lintFailures * 4);
  const claims = doc.claimSources?.length ?? 0;
  const sourcedClaims = (doc.claimSources ?? []).filter((c) => c.sources.length > 0).length;
  const factualCitationIntegrity = claims > 0 ? Math.round((sourcedClaims / claims) * 100) : 86;
  const exportCorrectness = doc.exports.length > 0 ? 92 : 40;
  const score = Math.round(
    structureFidelity * 0.25 +
      visualConsistency * 0.2 +
      readabilityDensity * 0.2 +
      factualCitationIntegrity * 0.15 +
      exportCorrectness * 0.2
  );
  const issues: string[] = [];
  if (lintFailures > 0) issues.push(`${lintFailures} chunk(s) still have lint issues`);
  if (doc.exports.length === 0) issues.push("no exports generated");
  return {
    docId: doc.id,
    score,
    structureFidelity,
    visualConsistency,
    readabilityDensity,
    factualCitationIntegrity,
    exportCorrectness,
    issues,
  };
}

export function defaultOutlineFromObjective(objective: string): string[] {
  const core = objective.trim() || "Presentation objective";
  return [
    "Title and context",
    "Problem and stakes",
    "Approach and solution",
    "Evidence and metrics",
    "Execution roadmap",
    "Risks and mitigations",
    "Decision and next steps",
  ].map((x) => `${x} — ${core.slice(0, 48)}`);
}

