/**
 * Pre-import environment side-effects for the reranker A/B (rerank_ab.ts).
 *
 * This module exists solely to run BEFORE @liminal/core / @liminal/tools are
 * imported, so the workspace + storage roots are pinned to a throwaway temp
 * directory. That keeps the A/B fully isolated from the user's real
 * ~/.liminal/notes.json and repo-root .agent_* files — we seed trap notes,
 * run recall twice, and the whole tree is disposable.
 *
 * Isolation knobs:
 *   - AGENT_GLOBAL_STORAGE_ROOT — redirects notes.json / memory.index.json etc.
 *     (notes default to USER-GLOBAL ~/.liminal, NOT the workspace, so this is
 *     the critical one — setting only AGENT_WORKSPACE_ROOT would still pollute
 *     real data).
 *   - AGENT_WORKSPACE_ROOT — legacy paths + workspace fingerprint.
 *   - AGENT_EMBED_MODEL="" — BM25-only first stage, so the ONLY difference
 *     between arms is the reranker (no embedding noise to confound the result).
 *   - AGENT_MEMORY_GRAPH=0 — no neighbor expansion in the output.
 *   - AGENT_TOOL_LAZY=0 — irrelevant here (we call handlers directly) but keeps
 *     env consistent with a non-lazy harness.
 *
 * The reranker arm still makes ONE real fast-model call (that's the thing under
 * test), so OPENROUTER_API_KEY must resolve — we alias it from AGENT_API_KEY.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const AB_TEMP_ROOT = mkdtempSync(path.join(tmpdir(), "rerank-ab-"));

function setIfUnset(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

// Hard overrides (always point at the temp tree, even if the shell had these set).
process.env["AGENT_GLOBAL_STORAGE_ROOT"] = AB_TEMP_ROOT;
process.env["AGENT_WORKSPACE_ROOT"] = AB_TEMP_ROOT;
process.env["AGENT_STORAGE_LAYOUT"] = ""; // use the split layout under the temp root

// Controlled retrieval conditions: BM25-only first stage, no graph expansion.
process.env["AGENT_EMBED_MODEL"] = "";
process.env["AGENT_MEMORY_GRAPH"] = "0";
process.env["AGENT_TOOL_LAZY"] = "0";

// The reranker reads OPENROUTER_API_KEY / OPENROUTER_BASE_URL (same convention
// as recall_relevant). Alias from the harness's AGENT_* provider vars when the
// OpenRouter-specific names are not already present. NEVER assign undefined —
// `process.env.X = undefined` coerces to the literal string "undefined".
if (process.env["AGENT_API_KEY"]) setIfUnset("OPENROUTER_API_KEY", process.env["AGENT_API_KEY"]!);
if (process.env["AGENT_API_BASE_URL"])
  setIfUnset("OPENROUTER_BASE_URL", process.env["AGENT_API_BASE_URL"]!);
