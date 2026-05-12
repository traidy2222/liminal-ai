/**
 * Merge near-duplicate notes + optional embedding-index dedupe (Phase 2 hook).
 */
import { defineTool } from "./helpers.js";
import { loadNotes, atomicUpdate } from "./notes_store.js";
import { cosineSimilarity, tokenize, withProviderRequestSpacing } from "@liminal/core";
import { loadEmbedIndex, saveEmbedIndex, pruneOrphanEmbeddingKeys } from "./memory_index.js";

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const u = a.size + b.size - inter;
  return u === 0 ? 0 : inter / u;
}

export const memoryConsolidateTool = defineTool({
  name: "memory_consolidate",
  description:
    "WHAT: Find near-duplicate `.agent_notes.json` entries (same type, high token overlap) and merge via LLM plan.\n" +
    "WHEN: memory_stats shows bloat or many similar keys. Requires OPENROUTER_API_KEY.\n" +
    "ARGS: dry_run — if true, only print the plan without applying.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      dry_run: {
        type: "boolean",
        description: "If true, show merge plan only (default false)",
      },
      prune_orphan_embeddings: {
        type: "boolean",
        description:
          "If true, drop embedding-index rows for keys not present in `.agent_notes.json` (visible-surface hygiene).",
      },
    },
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const dryRun = Boolean(args["dry_run"]);
    const pruneOrphans = Boolean(args["prune_orphan_embeddings"]);

    emit?.(`\nmemory_consolidate: loading notes…\n`);
    const notes = await loadNotes();
    const keys = Object.keys(notes);
    emit?.(`  ${keys.length} notes loaded — scanning for duplicates\n`);

    let pruneReport = "";
    if (pruneOrphans) {
      try {
        const idx = await loadEmbedIndex();
        const n = pruneOrphanEmbeddingKeys(idx, new Set(keys));
        if (n > 0) await saveEmbedIndex(idx);
        pruneReport = n > 0 ? `\nPruned ${n} orphan embedding row(s).` : "\nNo orphan embedding rows.";
      } catch {
        pruneReport = "\n(embedding prune skipped)";
      }
    }
    const byType = new Map<string, string[]>();
    for (const k of keys) {
      const colon = k.indexOf(":");
      const typ = colon > 0 ? k.slice(0, colon) : "general";
      if (!byType.has(typ)) byType.set(typ, []);
      byType.get(typ)!.push(k);
    }

    const pairs: Array<{ a: string; b: string; sim: number }> = [];
    for (const [, group] of byType) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const ka = group[i]!;
          const kb = group[j]!;
          const sa = new Set(tokenize(`${ka} ${notes[ka]}`));
          const sb = new Set(tokenize(`${kb} ${notes[kb]}`));
          const sim = jaccard(sa, sb);
          if (sim >= 0.86) pairs.push({ a: ka, b: kb, sim });
        }
      }
    }
    if (pairs.length === 0) {
      return {
        ok: true,
        output: "(no near-duplicate pairs found by token Jaccard ≥ 0.86)" + pruneReport,
      };
    }
    emit?.(`  found ${pairs.length} candidate pair(s) — requesting merge plan\n`);

    const apiKey = process.env["OPENROUTER_API_KEY"];
    if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY required for merge planning" };

    const model = process.env["AGENT_MEMORY_CONSOLIDATE_MODEL"]?.trim() || "openrouter/owl-alpha";
    const base = (process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(
      /\/$/,
      ""
    );

    const pairDesc = pairs
      .slice(0, 12)
      .map((p) => `{"keep":"${p.a}","drop":"${p.b}","reason":"jaccard=${p.sim.toFixed(2)}"}`)
      .join("\n");

    const res = await withProviderRequestSpacing(
      { apiKey, baseURL: base },
      () =>
        fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/liminal-ai",
            "X-Title": "Liminal-memory-consolidate",
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 500,
            messages: [
              {
                role: "system",
                content:
                  "You merge duplicate agent memory keys. Reply JSON only: {\"merges\":[{\"keep\":\"fullKey\",\"drop\":\"fullKey\",\"mergedValue\":\"text\"}]} " +
                  "Max 8 merges. Prefer keeping the more informative value. Same keep key only once.",
              },
              {
                role: "user",
                content: `Candidate duplicate pairs (high overlap):\n${pairDesc}\n\nFull values:\n` +
                  pairs
                    .slice(0, 6)
                    .map((p) => `${p.a}=${JSON.stringify(notes[p.a]).slice(0, 200)}…\n${p.b}=${JSON.stringify(notes[p.b]).slice(0, 200)}…`)
                    .join("\n"),
              },
            ],
          }),
        })
    );
    if (!res.ok) return { ok: false, error: await res.text() };
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content ?? "{}";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, error: "Model did not return JSON" };
    let plan: { merges?: Array<{ keep: string; drop: string; mergedValue: string }> };
    try {
      plan = JSON.parse(m[0]) as typeof plan;
    } catch {
      return { ok: false, error: "Invalid JSON from model" };
    }
    const merges = (plan.merges ?? []).filter(
      (x) =>
        x &&
        typeof x.keep === "string" &&
        typeof x.drop === "string" &&
        typeof x.mergedValue === "string" &&
        x.keep !== x.drop &&
        keys.includes(x.keep) &&
        keys.includes(x.drop)
    );
    if (merges.length === 0) {
      return { ok: true, output: "Model returned no applicable merges." + pruneReport };
    }

    let embedDedupe = "";
    try {
      const idx = await loadEmbedIndex();
      const ents = Object.entries(idx.entries);
      for (let i = 0; i < ents.length; i++) {
        for (let j = i + 1; j < ents.length; j++) {
          const [ka, ra] = ents[i]!;
          const [kb, rb] = ents[j]!;
          if (!ra.v.length || !rb.v.length) continue;
          if (cosineSimilarity(ra.v, rb.v) > 0.98 && ka !== kb) {
            embedDedupe += `\n[embed] very similar: ${ka} ≈ ${kb} (cos>0.98) — review manually`;
            break;
          }
        }
      }
    } catch {
      /* no index */
    }

    if (dryRun) {
      return {
        ok: true,
        output:
          `DRY RUN — ${merges.length} merge(s):\n` +
          merges.map((x) => `keep ${x.keep} ← drop ${x.drop}`).join("\n") +
          embedDedupe +
          pruneReport,
      };
    }

    await atomicUpdate((prev) => {
      const next = { ...prev };
      for (const { keep, drop, mergedValue } of merges) {
        if (!(keep in next) || !(drop in next)) continue;
        next[keep] = mergedValue;
        delete next[drop];
      }
      return next;
    });

    try {
      const idx = await loadEmbedIndex();
      for (const { drop } of merges) delete idx.entries[drop];
      await saveEmbedIndex(idx);
    } catch {
      /* ignore */
    }

    return {
      ok: true,
      output:
        `Applied ${merges.length} merge(s).\n` +
        merges.map((x) => `merged into ${x.keep}; removed ${x.drop}`).join("\n") +
        embedDedupe +
        pruneReport,
    };
  },
});
