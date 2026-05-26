/**
 * memory_neighbors — k semantically-nearest notes to a query or anchor key.
 *
 * Backed by the user-global note embedding index (memory_index.ts). Two modes:
 *   - key mode:  given an existing note key, return notes most similar to its
 *                stored vector (no LLM call required — pure cosine).
 *   - text mode: given an arbitrary text snippet, embed it once via the
 *                configured AGENT_EMBED_MODEL and run cosine against the index.
 *
 * Use cases:
 *   1. Contradiction detection: before writing a new fact, check whether a
 *      conflicting one already exists.
 *   2. Deduplication: confirm a near-duplicate exists before storing the same
 *      observation under a slightly different key.
 *   3. Broad context recall: "what else do I know related to this?"
 *
 * Returns notes after the same federation filters that recall_relevant uses,
 * so chat-private notes from other chats stay hidden.
 */
import { defineTool } from "./helpers.js";
import {
  cosineSimilarity,
  effectiveHarnessEnvRaw,
  fetchEmbeddings,
  resolveCurrentChatId,
} from "@liminal/core";
import { loadEmbedIndex } from "./memory_index.js";
import { loadRawNotes, getNoteValue, type StoredNote } from "./notes_store.js";

const DEFAULT_K = 6;
const MAX_K = 30;

export const memoryNeighborsTool = defineTool({
  name: "memory_neighbors",
  description:
    "WHAT: Return the k semantically-nearest notes to a query or anchor key (cross-chat, user-global index).\n" +
    "WHEN: Before writing a new fact (check for contradictions / near-duplicates), or to discover related notes you forgot you had.\n" +
    "NOT WHEN: You want full ranked retrieval — use recall_relevant. NOT WHEN you need exact key lookup — use recall.\n" +
    "ARGS: anchor_key OR text (one is required). k (default 6, max 30).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      anchor_key: {
        type: "string",
        description: "Existing note key to find neighbors for. Mutually exclusive with `text`.",
      },
      text: {
        type: "string",
        description: "Arbitrary text to embed and search. Mutually exclusive with `anchor_key`.",
      },
      k: { type: "number", description: `Max neighbors (default ${DEFAULT_K}, max ${MAX_K}).` },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args) => {
    const anchorKey = typeof args["anchor_key"] === "string" ? args["anchor_key"].trim() : "";
    const text = typeof args["text"] === "string" ? args["text"].trim() : "";
    if (!anchorKey && !text) return { ok: false, error: "anchor_key or text is required" };
    if (anchorKey && text) return { ok: false, error: "pass anchor_key OR text, not both" };
    const k = Math.min(MAX_K, Math.max(1, (args["k"] as number | undefined) ?? DEFAULT_K));

    const idx = await loadEmbedIndex();
    if (Object.keys(idx.entries).length === 0) {
      return {
        ok: true,
        output:
          "No embedded notes yet — run recall_relevant once to populate the index, or wait for the next memory write to embed lazily.",
      };
    }

    let queryVec: number[];
    if (anchorKey) {
      const row = idx.entries[anchorKey];
      if (!row || !row.v.length) {
        return { ok: false, error: `no embedding for '${anchorKey}' yet. Trigger one via recall_relevant.` };
      }
      queryVec = row.v;
    } else {
      const apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
      const baseURL = (process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
      const model = effectiveHarnessEnvRaw("AGENT_EMBED_MODEL")?.trim();
      if (!apiKey || !model) {
        return { ok: false, error: "AGENT_EMBED_MODEL + OPENROUTER_API_KEY required for text mode" };
      }
      try {
        const { vectors } = await fetchEmbeddings({ apiKey, baseURL, model, inputs: [text.slice(0, 8000)] });
        queryVec = vectors[0]!;
      } catch (e) {
        return { ok: false, error: `embedding failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    // Score every entry. Federation filters: chat-scope notes only visible to
    // their own chat; everything else passes through (workspace + global).
    const currentChatId = resolveCurrentChatId();
    const raw = await loadRawNotes();
    const scored: Array<{ id: string; score: number; value: string; provenance: string }> = [];
    for (const [id, row] of Object.entries(idx.entries)) {
      if (!row.v.length) continue;
      if (anchorKey && id === anchorKey) continue; // skip self
      const rich = raw[id];
      const noteScope =
        typeof rich === "object" && rich !== null ? (rich as StoredNote).scope : undefined;
      const noteChatId =
        typeof rich === "object" && rich !== null ? (rich as StoredNote).chatId : undefined;
      if (noteScope === "chat" && noteChatId !== currentChatId) continue;
      const score = cosineSimilarity(queryVec, row.v);
      if (score <= 0) continue;
      const value = rich ? getNoteValue(rich) : "";
      const provenance =
        noteChatId && currentChatId && noteChatId === currentChatId
          ? "own chat"
          : noteScope === "global"
            ? "global"
            : noteChatId
              ? `chat ${noteChatId.slice(0, 8)}`
              : "";
      scored.push({ id, score, value, provenance });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, k);
    if (top.length === 0) {
      return { ok: true, output: "No neighbors found." };
    }
    const lines = top.map(
      (n) =>
        `- [${n.id}] cos=${n.score.toFixed(3)}${n.provenance ? ` (${n.provenance})` : ""} — ${n.value.slice(0, 180)}${n.value.length > 180 ? "…" : ""}`
    );
    return { ok: true, output: `## Nearest ${top.length} note(s)\n${lines.join("\n")}` };
  },
});
