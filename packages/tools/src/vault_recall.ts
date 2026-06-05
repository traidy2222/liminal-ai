/**
 * vault_recall — GraphRAG-style retrieval over the vault brain.
 *
 * Flat search returns isolated notes; this returns a connected neighborhood:
 *   1. find entry-node notes by meaning (semantic index) + keywords (BM25)
 *   2. expand 1 hop along [[wikilinks]] and backlinks (local graph context)
 *   3. assemble note bodies into one answer within a token-ish char budget
 *
 * This is the retrieval half of the nexus — pair it with vault_ingest (the
 * write half). Use it to pull everything you know about a topic before
 * answering, instead of re-deriving from raw sources every time.
 */
import { defineTool } from "./helpers.js";
import {
  findNote,
  searchVault,
  getBacklinks,
  extractWikilinks,
  type VaultNote,
} from "./vault_store.js";
import { semanticVaultHits } from "./vault_embed.js";

const DEFAULT_MAX_NOTES = 6;
const DEFAULT_CHAR_BUDGET = 6000;

export const vaultRecallTool = defineTool({
  name: "vault_recall",
  description:
    "WHAT: Retrieve a connected neighborhood from the vault — the GraphRAG way to recall knowledge.\n" +
    "Finds the most relevant notes by meaning + keywords, then expands one hop along their\n" +
    "[[Wikilinks]] and backlinks, and returns the assembled note contents (not just titles).\n" +
    "WHEN: Before answering anything the vault may already cover — gives you the whole linked\n" +
    "cluster in one call instead of chaining vault_search → vault_read repeatedly.\n" +
    "ARGS: query — what to recall; max_notes — primary notes to seed (default 6); " +
    "expand — follow links 1 hop (default true); budget_chars — max total content (default 6000).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Topic / question to recall knowledge about" },
      max_notes: {
        type: "number",
        minimum: 1,
        maximum: 12,
        description: "Number of primary seed notes (default 6)",
      },
      expand: {
        type: "boolean",
        description: "Expand 1 hop along wikilinks/backlinks (default true)",
      },
      budget_chars: {
        type: "number",
        minimum: 1000,
        maximum: 20000,
        description: "Max total characters of assembled content (default 6000)",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const query = String(args["query"] ?? "").trim();
    if (!query) return { ok: false, error: "vault_recall requires a non-empty query." };
    const maxNotes = Math.max(1, Math.min(12, (args["max_notes"] as number | undefined) ?? DEFAULT_MAX_NOTES));
    const expand = args["expand"] !== false;
    const budget = Math.max(1000, Math.min(20000, (args["budget_chars"] as number | undefined) ?? DEFAULT_CHAR_BUDGET));

    emit?.(`\nvault_recall: "${query}"\n`);

    // ── 1. Seed: semantic + lexical, merged by title ──────────────────────────
    const seedTitles: string[] = [];
    const seen = new Set<string>();
    const pushTitle = (t: string) => {
      const k = t.trim().toLowerCase();
      if (k && !seen.has(k)) {
        seen.add(k);
        seedTitles.push(t);
      }
    };

    let mode: "hybrid" | "bm25" = "bm25";
    const sem = await semanticVaultHits(query, maxNotes);
    if (sem.length > 0) {
      mode = "hybrid";
      for (const h of sem) pushTitle(h.title);
    }
    try {
      const bm = await searchVault(query);
      for (const r of bm) pushTitle(r.note.title);
    } catch {
      /* empty vault */
    }

    if (seedTitles.length === 0) {
      return { ok: true, output: `No vault notes found for "${query}". The brain has nothing on this yet — consider vault_ingest after you learn it.` };
    }

    const primaryTitles = seedTitles.slice(0, maxNotes);

    // ── 2. Expand 1 hop along links + backlinks ───────────────────────────────
    const order: string[] = [...primaryTitles];
    const inGraph = new Set(primaryTitles.map((t) => t.toLowerCase()));
    if (expand) {
      for (const t of primaryTitles) {
        const note = await findNote(t);
        if (!note) continue;
        for (const fwd of extractWikilinks(note.body)) {
          if (!inGraph.has(fwd.toLowerCase())) {
            inGraph.add(fwd.toLowerCase());
            order.push(fwd);
          }
        }
        const back = await getBacklinks(note.title);
        for (const b of back) {
          if (!inGraph.has(b.title.toLowerCase())) {
            inGraph.add(b.title.toLowerCase());
            order.push(b.title);
          }
        }
      }
    }

    // ── 3. Assemble within budget (primaries first, then 1-hop neighbors) ──────
    const sections: string[] = [];
    let used = 0;
    let included = 0;
    for (const title of order) {
      if (used >= budget) break;
      const note: VaultNote | null = await findNote(title);
      if (!note) continue;
      const isPrimary = primaryTitles.some((p) => p.toLowerCase() === title.toLowerCase());
      const links = extractWikilinks(note.body);
      const remaining = budget - used;
      const bodyCap = Math.max(200, Math.min(isPrimary ? 1400 : 600, remaining));
      const bodyText = note.body.length > bodyCap ? `${note.body.slice(0, bodyCap)}…` : note.body;
      const header =
        `### [[${note.title}]] (${note.type})${isPrimary ? "" : "  · linked"}` +
        (links.length ? `\n→ ${links.slice(0, 6).map((l) => `[[${l}]]`).join("  ")}` : "");
      const section = `${header}\n${bodyText}`;
      sections.push(section);
      used += section.length;
      included += 1;
    }

    emit?.(`  ${included} notes (${mode}, ${used} chars)\n`);
    return {
      ok: true,
      output:
        `Vault recall for "${query}" — ${included} connected notes (${mode}, ~${used} chars):\n\n` +
        sections.join("\n\n---\n\n"),
    };
  },
});
