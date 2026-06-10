/**
 * hypothesize — structured working hypotheses with falsifiers and next tests.
 * Patches [WORKING STATE] epistemic hypotheses; optional typed remember(hypothesis:).
 */
import { randomBytes } from "node:crypto";
import type { AgentHarness } from "@liminal/core";
import { appendEpistemicHypothesis, rankDocumentsForQuery, type EpistemicHypothesisRow, effectiveHarnessEnvRaw } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { atomicUpdate, loadNotes, makeTypedKey, mergeNoteGraphFields } from "../memory/notes_store.js";

function newHypothesisId(): string {
  return `hyp:${randomBytes(5).toString("hex")}`;
}

function clampStr(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function normalizeConfidence(v: unknown): "low" | "med" | "high" {
  const t = String(v ?? "med").toLowerCase();
  if (t === "low" || t === "med" || t === "high") return t;
  return "med";
}

function normalizeStringArray(v: unknown, maxItems: number, maxEach: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = clampStr(x, maxEach);
    if (s.length > 0) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeEvidenceField(v: unknown, maxItems: number, maxEach: number): string[] {
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return [];
    const parts = t.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const src = parts.length > 1 ? parts : [t];
    return src.map((s) => clampStr(s, maxEach)).filter(Boolean).slice(0, maxItems);
  }
  return normalizeStringArray(v, maxItems, maxEach);
}

function buildMemoryBody(row: EpistemicHypothesisRow): string {
  const lines: string[] = [
    `claim: ${row.claim}`,
    `confidence: ${row.confidence}`,
    `status: ${row.status ?? "active"}`,
  ];
  if (row.id) lines.push(`id: ${row.id}`);
  if (row.rationale) lines.push(`rationale: ${row.rationale}`);
  if (row.evidence?.length) lines.push(`evidence:\n- ${row.evidence.join("\n- ")}`);
  if (row.falsifiers?.length) lines.push(`falsifiers:\n- ${row.falsifiers.join("\n- ")}`);
  if (row.next_test) lines.push(`next_test: ${row.next_test}`);
  return lines.join("\n");
}

export function createHypothesizeTool(harness: AgentHarness) {
  return defineTool({
    name: "hypothesize",
    description:
      "WHAT: Register a structured hypothesis in working state — claim, confidence, optional evidence, **falsifiers** (what would disprove it), and **next_test** (smallest next check). Optionally persist with remember(type:hypothesis).\n" +
      "WHEN: Ambiguous debugging, research, planning under uncertainty, or before expensive tool batches — makes assumptions falsifiable.\n" +
      "NOT WHEN: A plain prose trace suffices — use think() instead. Not a substitute for plan() step lists.\n" +
      "ARGS: hypothesis (main claim); confidence; evidence; falsifiers; next_test; rationale; supersede_id (mark prior hypothesis id superseded); remember + remember_key to store in durable memory.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        hypothesis: { type: "string", description: "Main claim (one sentence preferred)" },
        confidence: {
          type: "string",
          enum: ["low", "med", "high"],
          description: "Epistemic confidence in the claim",
        },
        evidence: {
          description:
            "Short bullets supporting the claim (optional, max 6). May be an array of strings or one newline-separated string.",
          anyOf: [
            { type: "array", items: { type: "string" } },
            { type: "string" },
          ],
        },
        falsifiers: {
          type: "array",
          items: { type: "string" },
          description: "Concrete observations that would weaken or refute the claim (max 8)",
        },
        next_test: {
          type: "string",
          description: "Smallest next action or observation to validate / invalidate",
        },
        rationale: { type: "string", description: "Why you hold this belief now (optional)" },
        supersede_id: {
          type: "string",
          description: "Optional prior hypothesis id from a previous hypothesize() to mark superseded",
        },
        remember: {
          type: "boolean",
          description: "If true, also persist via typed memory hypothesis:remember_key",
        },
        remember_key: {
          type: "string",
          description: "Slug for remember (required when remember is true)",
        },
      },
      required: ["hypothesis"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const rawClaim = String(args["hypothesis"] ?? "").trim();
      if (rawClaim.length < 8) {
        return { ok: false, error: "hypothesis must be a substantive claim (at least 8 characters)." };
      }
      const claim = clampStr(rawClaim, 900);
      const confidence = normalizeConfidence(args["confidence"]);
      const evidence = normalizeEvidenceField(args["evidence"], 6, 420);
      const falsifiers = normalizeStringArray(args["falsifiers"], 8, 280);
      const next_test = args["next_test"] != null ? clampStr(String(args["next_test"]), 520) : "";
      const rationale = args["rationale"] != null ? clampStr(String(args["rationale"]), 720) : "";
      const supersede_id =
        args["supersede_id"] != null ? clampStr(String(args["supersede_id"]), 80) : "";
      const remember = Boolean(args["remember"]);
      const rememberKeyRaw = args["remember_key"] != null ? String(args["remember_key"]).trim() : "";
      if (remember && rememberKeyRaw.length < 2) {
        return { ok: false, error: "remember_key is required when remember is true (short slug, e.g. auth-bug-theory)." };
      }

      const id = newHypothesisId();
      const row: EpistemicHypothesisRow = {
        id,
        claim,
        confidence,
        ...(evidence.length > 0 ? { evidence } : {}),
        ...(falsifiers.length > 0 ? { falsifiers } : {}),
        ...(next_test ? { next_test } : {}),
        ...(rationale ? { rationale } : {}),
        status: "active",
        at: Date.now(),
      };

      const ctx = harness.getContext();
      const es = ctx.getEpistemicState();
      const hadSupersedeTarget = Boolean(
        supersede_id && es?.hypotheses.some((h) => h.id === supersede_id)
      );
      if (es) {
        const nextHy = appendEpistemicHypothesis(es.hypotheses, row, {
          supersede_id: supersede_id || undefined,
        });
        ctx.patchEpistemicState({ hypotheses: nextHy });
      }

      let memoryLine = "";
      if (remember) {
        const storageKey = makeTypedKey("hypothesis", rememberKeyRaw);
        const body = buildMemoryBody(row);
        await atomicUpdate((notes) => ({ ...notes, [storageKey]: body }));
        if (effectiveHarnessEnvRaw("AGENT_MEMORY_GRAPH") !== "0") {
          const plain = await loadNotes();
          const otherKeys = Object.keys(plain).filter((x) => x !== storageKey);
          if (otherKeys.length > 0) {
            const docs = otherKeys.map((id) => ({ id, text: `${id} ${plain[id]}` }));
            const ranked = rankDocumentsForQuery(body.slice(0, 800), docs, { limit: 8 });
            const linkKeys = ranked.map((r) => r.id).slice(0, 4);
            if (linkKeys.length > 0) await mergeNoteGraphFields(storageKey, { links: linkKeys });
          }
        }
        memoryLine = `\nremembered as \`${storageKey}\``;
      }

      const supersededNote = supersede_id
        ? hadSupersedeTarget
          ? `\nsuperseded prior id: ${supersede_id}`
          : `\n(warning: supersede_id "${supersede_id}" not found in current hypotheses)`
        : "";

      const epistemicNote = es ? "" : "\n[note] working epistemic state was inactive — hypothesis not added to [WORKING STATE]; memory still saved if requested.";

      const out =
        `✓ Hypothesis registered **${id}** (${confidence})\n` +
        `**Claim:** ${claim}\n` +
        (falsifiers.length ? `**Falsifiers:**\n${falsifiers.map((f) => `- ${f}`).join("\n")}\n` : "") +
        (next_test ? `**Next test:** ${next_test}\n` : "") +
        memoryLine +
        supersededNote +
        epistemicNote;

      return { ok: true, output: out.trim() };
    },
  });
}
