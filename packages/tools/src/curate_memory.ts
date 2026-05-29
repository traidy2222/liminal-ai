/**
 * curate_memory — LLM-driven curation of the note store.
 *
 * Loads the notes (or the least-useful slice when the store is large), asks the
 * model to prune / merge / re-confidence them, applies a deterministic safety
 * veto (core/memory_curator.ts), then — unless dry_run — soft-deletes pruned +
 * merge-dropped notes to the reversible archive, writes merged values, adjusts
 * confidence, and prunes orphaned embedding rows.
 *
 * dry_run defaults to TRUE: the model can inspect the plan (and what the
 * guardrail vetoed) before anything is written. Mirrors memory_consolidate /
 * consolidate_chat for the provider call.
 */
import { defineTool } from "./helpers.js";
import {
  buildCuratorPrompt,
  parseCuratorPlan,
  applyCuratorSafetyRails,
  selectReviewSlice,
  resolveCuratorSafetyOpts,
  completeChatJson,
  getFastModelSlug,
  resolveProviderConfig,
  effectiveHarnessEnvRaw,
  type CuratorNote,
} from "@liminal/core";
import OpenAI from "openai";
import { loadRawNotes, atomicUpdate, setNoteConfidence, getNoteValue, getKeyType, type StoredNote } from "./notes_store.js";
import { archiveNotes } from "./notes_archive.js";
import { loadEmbedIndex, saveEmbedIndex, pruneOrphanEmbeddingKeys } from "./memory_index.js";

function toCuratorNote(key: string, note: StoredNote): CuratorNote {
  return {
    key,
    value: note.value,
    type: getKeyType(key) ?? undefined,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    lastAccessedAt: note.lastAccessedAt,
    accessCount: note.accessCount,
    confidence: note.confidence,
    scope: note.scope,
  };
}

export const curateMemoryTool = defineTool({
  name: "curate_memory",
  description:
    "WHAT: LLM-curate the note store — prune stale/duplicate notes, merge near-duplicates, and re-score confidence. " +
    "Pruned notes soft-delete to a reversible archive (restore_memory recovers them).\n" +
    "WHEN: memory_stats shows bloat, or you want to keep long-term memory high-signal. Requires a provider key.\n" +
    "NOT WHEN: You just want to find or read a memory — use recall_relevant / search_memory.\n" +
    "ARGS: dry_run — show the plan without writing (DEFAULT true). max_notes_considered — cap reviewed notes (default 200). scope_filter — only review this scope (chat|workspace|global).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      dry_run: { type: "boolean", description: "If true (default), return the plan + vetoes without writing." },
      max_notes_considered: { type: "number", minimum: 1, maximum: 1000, description: "Cap on notes reviewed (default 200)." },
      scope_filter: { type: "string", enum: ["chat", "workspace", "global"], description: "Only review notes of this scope." },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const dryRun = args["dry_run"] !== false; // default true
    const maxNotes = Math.min(1000, Math.max(1, (args["max_notes_considered"] as number | undefined) ?? 200));
    const scopeFilter = args["scope_filter"] as CuratorNote["scope"] | undefined;

    const raw = await loadRawNotes();
    const all: CuratorNote[] = [];
    const byKey = new Map<string, CuratorNote>();
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "string") continue; // legacy plain string — no metadata to curate safely
      if (scopeFilter && v.scope !== scopeFilter) continue;
      const cn = toCuratorNote(k, v);
      all.push(cn);
      byKey.set(k, cn);
    }
    if (all.length === 0) {
      return { ok: true, output: "No curatable notes (store empty or all legacy/plain-string)." };
    }

    const slice = selectReviewSlice(all, maxNotes);
    emit?.(`curate_memory: reviewing ${slice.length}/${all.length} note(s)…\n`);

    const provider = resolveProviderConfig();
    if (!provider.apiKey) return { ok: false, error: "provider API key missing" };
    const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });
    const model = effectiveHarnessEnvRaw("AGENT_MEMORY_CURATOR_MODEL")?.trim() || getFastModelSlug(provider.model);

    const timeoutRaw = parseInt(effectiveHarnessEnvRaw("AGENT_CONSOLIDATE_TIMEOUT_MS")?.trim() ?? "", 10);
    const timeoutMs = Number.isFinite(timeoutRaw) ? Math.max(5_000, Math.min(120_000, timeoutRaw)) : 30_000;

    let plan;
    try {
      const jr = await completeChatJson(client, {
        model,
        messages: [{ role: "user", content: buildCuratorPrompt(slice) }],
        maxTokens: 1500,
        temperature: 0.1,
        isFastModel: true,
        fallbackModel: provider.model,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!jr.ok) return { ok: false, error: jr.error };
      plan = parseCuratorPlan(jr.parsed);
    } catch (e) {
      return { ok: false, error: `curation call failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!plan) return { ok: false, error: "model returned an unparseable curation plan" };

    const { plan: vetted, vetoed } = applyCuratorSafetyRails(plan, byKey, resolveCuratorSafetyOpts());

    const planLines = [
      `Summary: ${vetted.summary || "(none)"}`,
      `Prune (${vetted.prune.length}): ${vetted.prune.map((p) => p.key).join(", ") || "—"}`,
      `Merge (${vetted.merge.length}): ${vetted.merge.map((m) => `${m.keep}←[${m.drop.join(",")}]`).join("; ") || "—"}`,
      `Adjust (${vetted.adjust.length}): ${vetted.adjust.map((a) => `${a.key}→${a.confidence.toFixed(2)}`).join(", ") || "—"}`,
      `Vetoed by safety rails (${vetoed.length}): ${vetoed.map((v) => `${v.key} [${v.rule}]`).join(", ") || "—"}`,
    ].join("\n");

    if (dryRun) {
      return { ok: true, output: `DRY RUN — nothing written.\n${planLines}` };
    }

    // Apply. Soft-delete pruned + merge-drops to the archive first, then mutate.
    const toArchive: Array<{ key: string; note: StoredNote; reason: string }> = [];
    for (const p of vetted.prune) {
      const n = raw[p.key];
      if (n && typeof n === "object") toArchive.push({ key: p.key, note: n, reason: `curate:prune:${p.reason}`.slice(0, 120) });
    }
    for (const m of vetted.merge) {
      for (const d of m.drop) {
        const n = raw[d];
        if (n && typeof n === "object") toArchive.push({ key: d, note: n, reason: `curate:merge→${m.keep}`.slice(0, 120) });
      }
    }
    const archived = await archiveNotes(toArchive);

    const removeKeys = new Set<string>([...vetted.prune.map((p) => p.key), ...vetted.merge.flatMap((m) => m.drop)]);
    await atomicUpdate((notes) => {
      const next = { ...notes };
      for (const m of vetted.merge) {
        if (m.keep in next) next[m.keep] = m.mergedValue; // fold merged text into the kept note
      }
      for (const k of removeKeys) delete next[k];
      return next;
    });

    let adjusted = 0;
    for (const a of vetted.adjust) {
      if (removeKeys.has(a.key)) continue;
      if (await setNoteConfidence(a.key, a.confidence)) adjusted++;
    }

    // Keep the embedding index consistent with the now-smaller store.
    let orphans = 0;
    try {
      const idx = await loadEmbedIndex();
      orphans = pruneOrphanEmbeddingKeys(idx, new Set(Object.keys(await loadRawNotes())));
      if (orphans > 0) await saveEmbedIndex(idx);
    } catch {
      /* no index — fine */
    }

    return {
      ok: true,
      output:
        `Applied curation.\n${planLines}\n` +
        `Archived ${archived} note(s); removed ${removeKeys.size}; merged ${vetted.merge.length}; confidence-adjusted ${adjusted}; pruned ${orphans} orphan embedding row(s).`,
    };
  },
});
