/**
 * Hybrid recall: BM25 (always) + optional cosine over indexed note embeddings.
 * Multi-query RRF when `queries` provided; optional HyDE for semantic vector.
 */
import { defineTool } from "./helpers.js";
import { loadNotes, loadRawNotes, bumpNoteMetadata, type StoredNote } from "./notes_store.js";
import {
  rankDocumentsForQuery,
  type RankableDoc,
  fetchEmbeddings,
  effectiveHarnessEnvRaw,
  workspaceFingerprint,
  resolveCurrentChatId,
  resolveManagedOpenRouterCredentials,
} from "@liminal/core";
import {
  loadEmbedIndex,
  upsertNoteEmbeddings,
  embedQueryAgainstIndex,
} from "./memory_index.js";
import { searchVault, getBacklinks, extractWikilinks, findNote, listAllNotes, titleToSlug } from "./vault_store.js";
import {
  loadVaultEmbedIndex,
  upsertVaultEmbeddings,
  embedQueryAgainstVaultIndex,
} from "./vault_index.js";
import { rerankEnabled, rerankWeight, rerankCandidates } from "./recall_rerank.js";

function normBm25Scores(scores: number[]): number[] {
  const m = Math.max(...scores, 1e-9);
  return scores.map((s) => s / m);
}

function normMap(m: Map<string, number>): Map<string, number> {
  let mx = 0;
  for (const v of m.values()) mx = Math.max(mx, v);
  if (mx <= 0) return m;
  const out = new Map<string, number>();
  for (const [k, v] of m) out.set(k, v / mx);
  return out;
}

/** Reciprocal rank fusion across ordered id lists. */
function rrfFuse(rankings: string[][], kConst = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankings) {
    list.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (kConst + idx + 1));
    });
  }
  return scores;
}

/**
 * Parse AGENT_RECALL_WEIGHTS="sem:rrf:bm" and return the weighted sum.
 * Falls back to default weights (0.45/0.35/0.20) if env var is absent or malformed.
 */
function recallWeights(sem: number, rrf: number, bm: number): number {
  const raw = effectiveHarnessEnvRaw("AGENT_RECALL_WEIGHTS")?.trim();
  if (raw) {
    const parts = raw.split(":").map(Number);
    if (parts.length === 3 && parts.every(isFinite) && parts.every((n) => n >= 0)) {
      const total = parts[0]! + parts[1]! + parts[2]!;
      if (total > 0) {
        return (parts[0]! / total) * sem + (parts[1]! / total) * rrf + (parts[2]! / total) * bm;
      }
    }
  }
  return 0.45 * sem + 0.35 * rrf + 0.2 * bm;
}

function parseIsoMs(s?: string): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((x) => x.length >= 3)
  );
}

function queryOverlap(a: string, b: string): number {
  const as = tokenize(a);
  const bs = tokenize(b);
  if (as.size === 0 || bs.size === 0) return 0;
  let inter = 0;
  for (const t of as) if (bs.has(t)) inter += 1;
  return inter / new Set([...as, ...bs]).size;
}

function tierWeight(opts: {
  updatedAtMs: number | null;
  lastAccessedMs: number | null;
  confidence: number;
  accessCount: number;
}): number {
  const now = Date.now();
  const updatedDays = opts.updatedAtMs ? (now - opts.updatedAtMs) / 86_400_000 : 9999;
  const accessedDays = opts.lastAccessedMs ? (now - opts.lastAccessedMs) / 86_400_000 : 9999;
  const hot =
    updatedDays <= 14 &&
    opts.confidence >= 0.7 &&
    (opts.accessCount >= 2 || accessedDays <= 30);
  if (hot) return 1.2;
  const warm = updatedDays <= 120 && opts.confidence >= 0.45;
  if (warm) return 1.0;
  return 0.62;
}

export const recallRelevantTool = defineTool({
  name: "recall_relevant",
  description:
    "WHAT: Ranked retrieval across session notes + vault for natural-language (multi-query RRF when `queries` set).\n" +
    "Uses BM25 + recency + type; when AGENT_EMBED_MODEL is set, adds semantic similarity on notes.\n" +
    "WHEN: Starting work on a topic, or when search_memory / vault_search feel too literal.\n" +
    "NOT WHEN: You need structured joins or exact key lookup — use memory_query (exact/type/graph) instead.\n" +
    "GOOD OUTPUT: A short ranked list of note/vault snippets tied to your query; fold only relevant lines into the user-facing answer.\n" +
    "ARGS: query OR queries (at least one required) — never pass scope alone; queries — array of sub-queries; hyde — optional hypothetical passage for embedding only; k or max_results (same limit, default 8); scope.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Single retrieval query" },
      queries: {
        type: "array",
        items: { type: "string" },
        description: "Multiple sub-queries (RRF fusion); overrides single query when non-empty",
      },
      hyde: {
        type: "string",
        description: "Hypothetical answer text for semantic embedding only (optional)",
      },
      k: { type: "number", description: "Max results per source (default 8, max 30)" },
      scope: {
        type: "string",
        enum: ["notes", "vault", "both"],
        description: "Where to search (default both)",
      },
      evidence_gaps: {
        type: "array",
        items: { type: "string" },
        description: "Optional missing evidence statements for closed-loop retrieval",
      },
      max_refine_rounds: {
        type: "number",
        description: "Closed-loop refinement rounds for evidence gaps (default 1, max 3)",
      },
      max_age_days: {
        type: "number",
        description: "Optional filter: exclude note/vault hits older than this age in days",
      },
      min_confidence: {
        type: "number",
        description: "Optional filter for notes: minimum confidence (0-1)",
      },
      min_query_overlap: {
        type: "number",
        description: "Optional filter: minimum token-overlap score with query (0-1)",
      },
      exclude_types: {
        type: "array",
        items: { type: "string" },
        description: "Optional note type prefixes to exclude (e.g. fact, reflection)",
      },
      expand_vault_neighbors: {
        type: "boolean",
        description: "When true, include linked neighbor notes from top vault hits",
      },
      actor_id: {
        type: "string",
        description: "Optional filter: only return notes written by this agent task ID.",
      },
      workspace_scope: {
        type: "string",
        enum: ["current", "all", "global_only"],
        description:
          "Workspace + federation filter. 'current' = only notes tagged with this workspace's fingerprint (strict scope). " +
          "'all' (default) = search across every workspace's notes; notes from the current workspace still get a small " +
          "ranking boost so same-project memory surfaces first while cross-project still appears when relevant. " +
          "'global_only' = only notes with scope='global' (durable identity facts) — use for privacy-sensitive turns " +
          "where sibling-chat workspace facts should not surface.",
      },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const kRaw = (args["k"] as number | undefined) ?? (args["max_results"] as number | undefined);
    const k = Math.min(30, Math.max(1, kRaw ?? 8));
    const scope = (args["scope"] as string | undefined) ?? "both";
    const hyde = typeof args["hyde"] === "string" ? args["hyde"].trim().slice(0, 2000) : "";
    const qArr = args["queries"] as string[] | undefined;
    const single = (args["query"] as string | undefined)?.trim() ?? "";
    const actorIdFilter = typeof args["actor_id"] === "string" ? args["actor_id"].trim() : undefined;
    const evidenceGaps = Array.isArray(args["evidence_gaps"])
      ? (args["evidence_gaps"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];
    const maxAgeDays =
      typeof args["max_age_days"] === "number" && Number.isFinite(args["max_age_days"])
        ? Math.max(1, Math.min(3650, Math.round(args["max_age_days"])))
        : undefined;
    const minConfidence =
      typeof args["min_confidence"] === "number" && Number.isFinite(args["min_confidence"])
        ? Math.max(0, Math.min(1, args["min_confidence"]))
        : undefined;
    const minQueryOverlap =
      typeof args["min_query_overlap"] === "number" && Number.isFinite(args["min_query_overlap"])
        ? Math.max(0, Math.min(1, args["min_query_overlap"]))
        : undefined;
    const excludeTypes = Array.isArray(args["exclude_types"])
      ? new Set((args["exclude_types"] as unknown[]).map((x) => String(x).trim().toLowerCase()).filter(Boolean))
      : new Set<string>();
    const refineRounds = Math.max(1, Math.min(3, (args["max_refine_rounds"] as number | undefined) ?? 1));
    const queries: string[] =
      Array.isArray(qArr) && qArr.length > 0
        ? qArr.map((x) => String(x).trim()).filter(Boolean).slice(0, 8)
        : single
          ? [single]
          : [];
    for (let i = 0; i < Math.min(evidenceGaps.length, refineRounds); i++) {
      queries.push(`${queries[0] ?? single} ${evidenceGaps[i]}`);
    }
    if (queries.length === 0) return { ok: false, error: "query or queries required" };

    const embedModel = effectiveHarnessEnvRaw("AGENT_EMBED_MODEL")?.trim();
    let apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
    let baseURL = (process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(
      /\/$/,
      ""
    );
    if (embedModel) {
      try {
        const creds = await resolveManagedOpenRouterCredentials(null);
        apiKey = creds.apiKey;
        baseURL = creds.baseURL;
      } catch {
        /* keep env fallback */
      }
    }

    const lines: string[] = [];
    const bumpKeys: string[] = [];

    const queryLabel = queries.length > 1 ? `${queries.length} queries` : (queries[0] ?? "").slice(0, 60);
    emit?.(`\nrecall_relevant: ${queryLabel} (scope=${scope})\n`);

    // Pull current chat + workspace context once. Both come from
    // AsyncLocalStorage scopes set by AgentHarness.send() — undefined when
    // recall is invoked outside an active harness (CLI, eval), in which case
    // the ranker degrades to "all notes, no federation discount."
    const currentChatId = resolveCurrentChatId();
    const currentFp = workspaceFingerprint();
    const siblingDiscountRaw = Number(effectiveHarnessEnvRaw("AGENT_RECALL_SIBLING_DISCOUNT") ?? "0.85");
    const siblingDiscount = Number.isFinite(siblingDiscountRaw)
      ? Math.max(0.1, Math.min(1, siblingDiscountRaw))
      : 0.85;
    const wsScopeArg = args["workspace_scope"] as string | undefined;
    const workspaceScope: "current" | "all" | "global_only" =
      wsScopeArg === "current" ? "current" : wsScopeArg === "global_only" ? "global_only" : "all";

    if (scope === "notes" || scope === "both") {
      const plain = await loadNotes();
      const raw = await loadRawNotes();
      const docs: RankableDoc[] = Object.entries(plain).map(([id, value]) => {
        const rv = raw[id];
        const rich = typeof rv === "object" && rv !== null ? (rv as StoredNote) : null;
        const colon = id.indexOf(":");
        const memoryType = colon > 0 ? id.slice(0, colon) : undefined;
        return {
          id,
          text: `${id} ${value}`,
          updatedAt: rich?.updatedAt,
          lastAccessedAt: rich?.lastAccessedAt,
          memoryType,
          accessCount: rich?.accessCount,
          confidence: rich?.confidence,
          workspaceFingerprint: rich?.workspaceFingerprint,
          chatId: rich?.chatId,
          scope: rich?.scope,
        };
      });

      const perQueryRankings: string[][] = [];
      for (const q of queries) {
        const bmRanked = rankDocumentsForQuery(q, docs, {
          limit: k * 4,
          currentWorkspaceFingerprint: currentFp,
          requireWorkspaceMatch: workspaceScope === "current",
          currentChatId,
          siblingDiscount,
          globalOnly: workspaceScope === "global_only",
        });
        perQueryRankings.push(bmRanked.map((x) => x.id));
      }
      const rrfById = normMap(rrfFuse(perQueryRankings));

      const bmById = new Map<string, number>();
      const anchor = queries[0] ?? "";
      const bmRanked0 = rankDocumentsForQuery(anchor, docs, {
        limit: k * 4,
        currentWorkspaceFingerprint: currentFp,
        requireWorkspaceMatch: workspaceScope === "current",
        currentChatId,
        siblingDiscount,
        globalOnly: workspaceScope === "global_only",
      });
      const bmNorms0 = normBm25Scores(bmRanked0.map((x) => x.score));
      bmRanked0.forEach((r, i) => bmById.set(r.id, bmNorms0[i] ?? 0));

      const semById = new Map<string, number>();
      if (embedModel && apiKey) {
        emit?.(`  embedding lookup (${embedModel.split("/").pop()})…\n`);
        try {
          await upsertNoteEmbeddings({
            apiKey,
            baseURL,
            model: embedModel,
            notes: plain,
          });
          const idx = await loadEmbedIndex();
          const embedText = (hyde || queries.join(" | ")).slice(0, 8000);
          const { vectors } = await fetchEmbeddings({
            apiKey,
            baseURL,
            model: embedModel,
            inputs: [embedText],
          });
          const qv = vectors[0]!;
          for (const { key, score } of embedQueryAgainstIndex(qv, idx, k * 4)) {
            semById.set(key, score);
          }
        } catch {
          /* embeddings optional */
        }
      }

      const semN = normMap(semById);
      const fused: Array<{ id: string; score: number; value: string; provenance: string }> = [];
      const allIds = new Set<string>([...rrfById.keys(), ...semN.keys(), ...bmById.keys()]);
      for (const id of allIds) {
        const rv = raw[id];
        const noteType = id.includes(":") ? id.slice(0, id.indexOf(":")).toLowerCase() : "";
        if (noteType && excludeTypes.has(noteType)) continue;
        if (actorIdFilter) {
          const noteActorId = typeof rv === "object" && rv !== null && "actorId" in rv
            ? (rv as StoredNote).actorId : undefined;
          if (noteActorId !== actorIdFilter) continue;
        }
        // Federation Phase 2 — the BM25 leg already enforces chat-scope and
        // workspace-scope filters via the ranker. The semantic leg builds its
        // own candidate set from the embedding index without that filter, so
        // re-enforce here so semantic-only hits don't bypass the federation
        // rules.
        const noteScope =
          typeof rv === "object" && rv !== null ? (rv as StoredNote).scope : undefined;
        const noteChatId =
          typeof rv === "object" && rv !== null ? (rv as StoredNote).chatId : undefined;
        const noteWsFp =
          typeof rv === "object" && rv !== null ? (rv as StoredNote).workspaceFingerprint : undefined;
        if (noteScope === "chat" && noteChatId !== currentChatId) continue;
        if (workspaceScope === "global_only" && noteScope !== "global") continue;
        if (workspaceScope === "current" && currentFp && noteWsFp && noteWsFp !== currentFp) continue;
        const confidence =
          typeof rv === "object" && rv !== null && "confidence" in rv
            ? Number((rv as StoredNote).confidence ?? 0.5)
            : 0.5;
        if (minConfidence != null && confidence < minConfidence) continue;
        const updatedAtMs =
          typeof rv === "object" && rv !== null && "updatedAt" in rv
            ? parseIsoMs((rv as StoredNote).updatedAt)
            : null;
        if (maxAgeDays != null && updatedAtMs != null) {
          const ageDays = (Date.now() - updatedAtMs) / 86_400_000;
          if (ageDays > maxAgeDays) continue;
        }
        const val = plain[id] ?? "";
        if (minQueryOverlap != null) {
          const ov = queryOverlap(queries.join(" "), `${id} ${val}`);
          if (ov < minQueryOverlap) continue;
        }
        const rrf = rrfById.get(id) ?? 0;
        const bm = bmById.get(id) ?? 0;
        const sem = semN.get(id) ?? 0;
        const accessedAtMs =
          typeof rv === "object" && rv !== null && "lastAccessedAt" in rv
            ? parseIsoMs((rv as StoredNote).lastAccessedAt)
            : null;
        const accessCount =
          typeof rv === "object" && rv !== null && "accessCount" in rv
            ? Number((rv as StoredNote).accessCount ?? 0)
            : 0;
        const tier = tierWeight({
          updatedAtMs,
          lastAccessedMs: accessedAtMs,
          confidence,
          accessCount,
        });
        // Build a one-shot provenance label for this candidate so the model
        // (and the audit UI) can see where the fact came from. Format priority:
        //   "own chat" > "sibling chat" > "global" > "" (no metadata to show)
        let provenance = "";
        if (currentChatId && noteChatId) {
          if (noteChatId === currentChatId) {
            provenance = "own chat";
          } else if (noteWsFp && currentFp && noteWsFp === currentFp) {
            provenance = `sibling chat ${noteChatId.slice(0, 8)}`;
          } else if (noteScope === "global") {
            provenance = "global";
          } else {
            provenance = `chat ${noteChatId.slice(0, 8)}`;
          }
        } else if (noteScope === "global") {
          provenance = "global";
        }
        const hybrid = recallWeights(sem, rrf, bm) * tier;
        if (hybrid < 0.008) continue;
        fused.push({ id, score: hybrid, value: val, provenance });
      }
      fused.sort((a, b) => b.score - a.score);

      // Semantic near-miss dedup: remove entries with >85% token overlap with a
      // higher-ranked result, so two near-identical notes don't both appear.
      const dedupedFused: typeof fused = [];
      for (const candidate of fused) {
        const isDuplicate = dedupedFused.some((kept) => {
          const ov = queryOverlap(`${candidate.id} ${candidate.value}`, `${kept.id} ${kept.value}`);
          return ov >= 0.85;
        });
        if (!isDuplicate) dedupedFused.push(candidate);
        if (dedupedFused.length >= k * 3) break; // early exit after enough candidates
      }

      // Second-stage rerank: judge true query→candidate relevance with one
      // fast-model call over the shortlist, then blend into the hybrid score.
      // Off by default (AGENT_RECALL_RERANK); degrades to first-stage order on
      // any failure. Runs before the k-slice so a low-fusion-but-high-relevance
      // note can still be promoted into the top-k.
      if (rerankEnabled() && dedupedFused.length > 1) {
        emit?.(`  rerank (fast model)…\n`);
        try {
          const window = dedupedFused.slice(0, 25);
          const scores = await rerankCandidates(
            queries.join(" "),
            window.map((c) => ({ id: c.id, text: c.value })),
            { maxCandidates: 25 }
          );
          if (scores) {
            const w = rerankWeight();
            for (const c of window) {
              const rel = scores.get(c.id);
              if (rel != null) c.score = c.score * (1 + w * rel);
            }
            dedupedFused.sort((a, b) => b.score - a.score);
          }
        } catch {
          /* rerank optional — keep first-stage order */
        }
      }

      let top = dedupedFused.slice(0, k);

      if (effectiveHarnessEnvRaw("AGENT_MEMORY_GRAPH") !== "0" && top.length > 0) {
        const extra = new Map<string, { id: string; score: number; value: string; provenance: string }>();
        // visited guards against re-adding items already in top and prevents
        // redundant traversal when bidirectional links (A→B, B→A) exist.
        const visited = new Set(top.map((t) => t.id));
        const floor = top.length > 0 ? top[top.length - 1]!.score * 0.35 : 0;
        for (const t of top.slice(0, Math.min(6, top.length))) {
          const rv = raw[t.id];
          if (!rv || typeof rv === "string") continue;
          const links = (rv as StoredNote).links ?? [];
          for (const lk of links) {
            if (visited.has(lk) || !plain[lk] || extra.has(lk)) continue;
            visited.add(lk);
            extra.set(lk, {
              id: lk,
              score: floor,
              value: plain[lk] ?? "",
              provenance: "graph neighbor",
            });
          }
        }
        top = [...top, ...[...extra.values()].filter((x) => !top.some((y) => y.id === x.id))].slice(
          0,
          k + 6
        );
      }

      if (top.length === 0) {
        lines.push("(no note matches)");
      } else {
        lines.push("## Notes");
        for (const t of top.slice(0, k + 4)) {
          const prov = t.provenance ? ` (${t.provenance})` : "";
          lines.push(
            `- [${t.id}] score=${t.score.toFixed(3)}${prov} — ${t.value.slice(0, 200)}${t.value.length > 200 ? "…" : ""}`
          );
          bumpKeys.push(t.id);
        }
      }
    }

    if (scope === "vault" || scope === "both") {
      const byTitle = new Map<
        string,
        { note: Awaited<ReturnType<typeof searchVault>>[number]["note"]; snippet: string; score: number }
      >();
      for (const q of queries.slice(0, 4)) {
        const found = await searchVault(q, {});
        found.slice(0, k + 8).forEach((hit, idx) => {
          const updatedMs = new Date(hit.note.updated).getTime();
          if (maxAgeDays != null && Number.isFinite(updatedMs)) {
            const ageDays = (Date.now() - updatedMs) / 86_400_000;
            if (ageDays > maxAgeDays) return;
          }
          if (minQueryOverlap != null) {
            const ov = queryOverlap(queries.join(" "), `${hit.note.title} ${hit.snippet}`);
            if (ov < minQueryOverlap) return;
          }
          const existing = byTitle.get(hit.note.title);
          const recencyBoost = Math.max(
            0,
            0.2 - (Date.now() - new Date(hit.note.updated).getTime()) / (1000 * 60 * 60 * 24 * 365) * 0.2
          );
          const rankScore = 1 / (idx + 1) + recencyBoost;
          if (!existing || rankScore > existing.score) {
            byTitle.set(hit.note.title, {
              note: hit.note,
              snippet: hit.snippet,
              score: rankScore,
            });
          }
        });
      }
      // Federation Phase 2 — fold semantic similarity into the vault leg when
      // an embedding model is configured. The semantic index is keyed by slug
      // (titleToSlug), parallel to memory_index for notes. Falls back to pure
      // BM25 + recency when embeddings are unavailable.
      if (embedModel && apiKey) {
        try {
          // Ensure every vault note is in the index (idempotent — only re-embeds
          // notes whose body content hash changed).
          const allVault = await listAllNotes({ limit: 500 });
          await upsertVaultEmbeddings({
            apiKey,
            baseURL,
            model: embedModel,
            notes: allVault.map((n) => ({
              slug: n.slug,
              title: n.title,
              type: n.type,
              body: n.body,
            })),
          });
          const idx = await loadVaultEmbedIndex();
          const embedText = (hyde || queries.join(" | ")).slice(0, 8000);
          const { vectors } = await fetchEmbeddings({
            apiKey,
            baseURL,
            model: embedModel,
            inputs: [embedText],
          });
          const qv = vectors[0]!;
          const semHits = embedQueryAgainstVaultIndex(qv, idx, k * 4);
          // Build a slug→title map so the merge keys stay consistent with the
          // BM25 byTitle map (titles are the user-facing identifier).
          const titleBySlug = new Map<string, string>();
          for (const n of allVault) titleBySlug.set(n.slug, n.title);
          // Normalize semantic scores and fuse: keep BM25-derived score on top
          // and additively bump with normalized semantic score so paraphrase
          // matches surface even when the keyword search missed them.
          const maxSem = Math.max(...semHits.map((h) => h.score), 1e-9);
          for (const sh of semHits) {
            const title = titleBySlug.get(sh.slug) ?? sh.title;
            const note = (await findNote(title)) ?? null;
            if (!note) continue;
            if (maxAgeDays != null) {
              const updatedMs = new Date(note.updated).getTime();
              if (Number.isFinite(updatedMs) && (Date.now() - updatedMs) / 86_400_000 > maxAgeDays) continue;
            }
            const semBoost = (sh.score / maxSem) * 0.4; // 0–0.4 additive
            const existing = byTitle.get(title);
            if (existing) {
              existing.score = existing.score + semBoost;
            } else {
              byTitle.set(title, {
                note,
                snippet: note.body.replace(/\s+/g, " ").slice(0, 180),
                score: semBoost,
              });
            }
          }
        } catch {
          /* embeddings optional — silent fallback to BM25-only */
        }
      }
      // Suppress unused-var warning for titleToSlug import (kept for future
      // use in slug ↔ title round-trips).
      void titleToSlug;
      let vhits = [...byTitle.values()].sort((a, b) => b.score - a.score);
      if (args["expand_vault_neighbors"] === true && vhits.length > 0) {
        const seeds = vhits.slice(0, 3).map((h) => h.note.title);
        for (const seed of seeds) {
          const seedNote = await findNote(seed);
          if (!seedNote) continue;
          const fwd = extractWikilinks(seedNote.body).slice(0, 4);
          const back = (await getBacklinks(seedNote.title)).slice(0, 4).map((n) => n.title);
          for (const title of [...fwd, ...back]) {
            if (byTitle.has(title)) continue;
            const linked = await findNote(title);
            if (!linked) continue;
            byTitle.set(linked.title, {
              note: linked,
              snippet: linked.body.replace(/\s+/g, " ").slice(0, 180),
              score: 0.15,
            });
          }
        }
        vhits = [...byTitle.values()].sort((a, b) => b.score - a.score);
      }
      lines.push("## Vault");
      if (vhits.length === 0) lines.push("(no vault matches)");
      else {
        for (const h of vhits.slice(0, k + 4)) {
          lines.push(
            `- [[${h.note.title}]] (${h.note.type}) score=${h.score.toFixed(3)} — ${h.snippet.replace(/\s+/g, " ").slice(0, 180)}`
          );
        }
      }
    }

    void bumpNoteMetadata(bumpKeys);
    return { ok: true, output: lines.join("\n") };
  },
});
