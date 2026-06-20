/**
 * vault_lint — keep the brain healthy.
 *
 * A wiki's value is its link density, so the main defect is the ORPHAN (a note
 * nothing links to). This tool reports orphans, near-duplicate/possibly-
 * contradicting pairs, and stale notes — and with fix:true it weaves orphans
 * back into the graph by linking them to their nearest neighbor.
 */
import { defineTool } from "../../shared/helpers.js";
import {
  listAllNotes,
  getBacklinks,
  extractWikilinks,
  findNearDuplicateNote,
  writeVaultNote,
  searchVault,
} from "./vault_store.js";
import { semanticVaultHits } from "./vault_embed.js";
import { selectCrossLinks, injectRelatedLinkRefs, type NeighborCandidate } from "./vault_nexus.js";
import { noteRelLinkPath } from "./vault_wikilink.js";
import { isAgentManagedNote, canAutoEditNote } from "./vault_agent_zone.js";

function daysSince(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export const vaultLintTool = defineTool({
  name: "vault_lint",
  description:
    "WHAT: Audit (and optionally repair) the vault knowledge graph.\n" +
    "Reports ORPHAN notes (nothing links to them), near-duplicate/contradicting pairs, and stale notes.\n" +
    "With fix:true, links each orphan to its nearest neighbor so the graph stays connected.\n" +
    "WHEN: Periodically, after bulk ingestion, or when the vault feels disconnected.\n" +
    "ARGS: fix — repair orphans by linking them (default false); stale_days — flag notes older than this " +
    "(default 0 = off); limit — max notes to scan (default 400).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      fix: { type: "boolean", description: "Link orphans to nearest neighbor (default false)" },
      stale_days: {
        type: "number",
        minimum: 0,
        description: "Flag notes not updated in this many days (0 = skip)",
      },
      limit: { type: "number", minimum: 1, maximum: 2000, description: "Max notes to scan (default 400)" },
    },
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const fix = args["fix"] === true;
    const staleDays = Math.max(0, (args["stale_days"] as number | undefined) ?? 0);
    const limit = Math.max(1, Math.min(2000, (args["limit"] as number | undefined) ?? 400));

    emit?.(`\nvault_lint${fix ? " (fix, agent zone)" : ""}\n`);
    const allNotes = await listAllNotes({ limit });
    if (allNotes.length === 0) return { ok: true, output: "(vault is empty — nothing to lint)" };

    const orphans: string[] = [];
    const stale: string[] = [];
    const dupes: string[] = [];
    let fixedCount = 0;
    let agentOrphanCount = 0;

    for (const note of allNotes) {
      const backlinks = await getBacklinks(note.title);
      const isOrphan = backlinks.length === 0;
      const agentNote = isAgentManagedNote(note);
      if (isOrphan && agentNote) agentOrphanCount++;

      if (isOrphan) {
        if (fix && agentNote) {
          // An orphan has no INBOUND links. To de-orphan it, add a [[link]] to it
          // from its nearest neighbor (editing the neighbor, not the orphan).
          const cands = new Map<string, NeighborCandidate>();
          for (const h of await semanticVaultHits(`${note.title}\n\n${note.body}`, 6)) {
            if (h.title.toLowerCase() === note.title.toLowerCase()) continue;
            cands.set(h.title.toLowerCase(), { title: h.title, slug: h.slug, score: h.score });
          }
          if (cands.size === 0) {
            try {
              const bm = await searchVault(`${note.title} ${note.body.slice(0, 200)}`);
              bm.slice(0, 6).forEach((r, i) => {
                if (r.note.title.toLowerCase() === note.title.toLowerCase()) return;
                cands.set(r.note.title.toLowerCase(), {
                  title: r.note.title,
                  slug: r.note.slug,
                  score: Math.max(0.18, 0.6 - i * 0.05),
                });
              });
            } catch {
              /* ignore */
            }
          }
          const [nearestTitle] = selectCrossLinks(note.title, [...cands.values()], {
            max: 1,
            minScore: 0.18,
          });
          const neighbor = nearestTitle
            ? allNotes.find((n) => n.title.toLowerCase() === nearestTitle.toLowerCase()) ?? null
            : null;
          if (
            neighbor &&
            canAutoEditNote(neighbor) &&
            !extractWikilinks(neighbor.body).some((l) => {
              const key = l.split("/").pop()?.toLowerCase() ?? l.toLowerCase();
              return key === note.slug.toLowerCase() || l.toLowerCase() === note.title.toLowerCase();
            })
          ) {
            const orphanRef = { target: noteRelLinkPath(note), label: note.title };
            const body = injectRelatedLinkRefs(neighbor.body, [orphanRef]);
            await writeVaultNote({
              title: neighbor.title,
              body,
              type: neighbor.type,
              tags: neighbor.tags,
            });
            fixedCount += 1;
            orphans.push(`[[${note.title}]] ← now linked from [[${neighbor.title}]]`);
          } else {
            orphans.push(`[[${note.title}]] (no neighbor to link from)`);
          }
        } else {
          const suffix = agentNote ? " (agent)" : " (human — not auto-fixed)";
          orphans.push(`[[${note.title}]] (${note.type})${suffix}`);
        }
      }

      if (staleDays > 0 && daysSince(note.updated) >= staleDays) {
        stale.push(`[[${note.title}]] — ${daysSince(note.updated)}d old`);
      }
    }

    // Near-duplicate / possible-contradiction pairs (bounded scan).
    const checked = new Set<string>();
    for (const note of allNotes.slice(0, 120)) {
      if (fix && !isAgentManagedNote(note)) continue;
      const near = await findNearDuplicateNote(note.title, note.body, { limit: 1, threshold: 0.72 });
      for (const d of near) {
        const pairKey = [note.title.toLowerCase(), d.note.title.toLowerCase()].sort().join("::");
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);
        dupes.push(`[[${note.title}]] ≈ [[${d.note.title}]] (${d.score.toFixed(2)}) — merge or add [!contradiction]`);
      }
    }

    const lines: string[] = [
      `Vault lint — scanned ${allNotes.length} notes.`,
      `Agent-zone orphans: ${agentOrphanCount}${fix ? ` (fix attempted on agent notes only)` : ""}`,
    ];
    lines.push(`\nOrphans (no inbound links): ${orphans.length}${fix ? ` — fixed ${fixedCount}` : ""}`);
    if (orphans.length) lines.push(orphans.slice(0, 30).map((o) => `  • ${o}`).join("\n"));
    lines.push(`\nNear-duplicate/contradiction pairs: ${dupes.length}`);
    if (dupes.length) lines.push(dupes.slice(0, 20).map((d) => `  • ${d}`).join("\n"));
    if (staleDays > 0) {
      lines.push(`\nStale (>${staleDays}d): ${stale.length}`);
      if (stale.length) lines.push(stale.slice(0, 20).map((s) => `  • ${s}`).join("\n"));
    }
    if (!fix && orphans.length > 0) lines.push(`\nRun vault_lint with fix:true to auto-link orphans.`);

    emit?.(`  orphans=${orphans.length} dupes=${dupes.length}${fix ? ` fixed=${fixedCount}` : ""}\n`);
    return { ok: true, output: lines.join("\n") };
  },
});
