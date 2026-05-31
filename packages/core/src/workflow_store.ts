/**
 * Out-of-context result store for dynamic workflows.
 *
 * The whole point of a workflow is that intermediate sub-agent results live
 * HERE — on disk + a small in-memory BM25 index — instead of in the parent
 * harness context window. The parent only ever sees distilled phase summaries;
 * full per-agent outputs are recoverable on demand via `query()` (the
 * query_workflow tool) without re-running anything.
 *
 * Layout: <workspace>/.agent_workflows/<runId>/
 *   manifest.json            — spec + final report
 *   <phaseId>__<taskId>.json — one file per sub-agent result
 *
 * BM25 ranking is modeled on SessionToolIndex (session_tool_index.ts).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { rankDocumentsForQuery, type RankableDoc } from "./memory_rank.js";

export interface WorkflowAgentResult {
  phaseId: string;
  taskId: string;
  goal: string;
  ok: boolean;
  output: string;
  at: string; // ISO
  /** "agent" for a fan-out worker, "review" for an adversarial reviewer. */
  kind?: "agent" | "review";
}

export interface WorkflowQueryHit {
  phaseId: string;
  taskId: string;
  excerpt: string;
  score: number;
}

const MAX_OUTPUT_PER_ENTRY = 20_000;
const EXCERPT_CHARS = 700;

/** Resolve the directory for a workflow run under the workspace root. */
export function workflowRunDir(runId: string): string {
  return path.join(resolveWorkspaceRoot(), ".agent_workflows", sanitizeRunId(runId));
}

function sanitizeRunId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  return cleaned.length > 0 ? cleaned : "run";
}

function excerptAround(text: string, query: string, max: number): string {
  const lower = text.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return text.slice(0, max).trim();
  const start = Math.max(0, idx - Math.floor(max / 3));
  return (start > 0 ? "…" : "") + text.slice(start, start + max).trim() + (start + max < text.length ? "…" : "");
}

/**
 * Per-run store. Holds full agent outputs out of the parent context; persists
 * each to disk and keeps a trimmed in-memory copy for BM25 retrieval.
 */
export class WorkflowStore {
  private readonly entries: WorkflowAgentResult[] = [];
  private dirEnsured = false;

  constructor(private readonly runId: string) {}

  private async ensureDir(): Promise<string> {
    const dir = workflowRunDir(this.runId);
    if (!this.dirEnsured) {
      await mkdir(dir, { recursive: true });
      this.dirEnsured = true;
    }
    return dir;
  }

  /** Persist one sub-agent (or reviewer) result and index it in memory. */
  async add(result: WorkflowAgentResult): Promise<void> {
    const trimmed: WorkflowAgentResult = {
      ...result,
      output: result.output.slice(0, MAX_OUTPUT_PER_ENTRY),
    };
    this.entries.push(trimmed);
    try {
      const dir = await this.ensureDir();
      const file = path.join(dir, `${sanitizeRunId(result.phaseId)}__${sanitizeRunId(result.taskId)}.json`);
      await writeFile(file, JSON.stringify(trimmed, null, 2), "utf8");
    } catch {
      // Disk failure must not abort the run — the in-memory copy still serves query().
    }
  }

  /** BM25 retrieval over stored outputs. Returns top-k excerpts. */
  query(queryText: string, topK = 5): WorkflowQueryHit[] {
    if (!queryText.trim() || this.entries.length === 0) return [];
    const docs: RankableDoc[] = this.entries.map((e, i) => ({
      id: String(i),
      text: `${e.phaseId} ${e.goal} ${e.output}`,
    }));
    const ranked = rankDocumentsForQuery(queryText, docs, { limit: topK });
    return ranked.map((r) => {
      const e = this.entries[Number(r.id)]!;
      return {
        phaseId: e.phaseId,
        taskId: e.taskId,
        excerpt: excerptAround(e.output, queryText, EXCERPT_CHARS),
        score: r.score,
      };
    });
  }

  all(): readonly WorkflowAgentResult[] {
    return this.entries;
  }

  forPhase(phaseId: string): WorkflowAgentResult[] {
    return this.entries.filter((e) => e.phaseId === phaseId);
  }

  /** Write the run manifest (spec + final report) for audit / future resumption. */
  async writeManifest(manifest: unknown): Promise<void> {
    try {
      const dir = await this.ensureDir();
      await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    } catch {
      /* best effort */
    }
  }
}
