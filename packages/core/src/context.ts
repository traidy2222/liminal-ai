import type { Message, ContextConfig, ContextSnapshot, EpistemicState } from "./types.js";
import {
  emptyEpistemicState,
  mergeEpistemicState,
  renderEpistemicStateBlock,
} from "./epistemic_state.js";
import { estimateMessagesTokens } from "./token_estimate.js";
import { stashToolBodyElide, writeArtifact, artifactPathForHash } from "./output_distill.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { extractFactsRaw } from "./fact_extractor.js";

/** Prepended to auto / forced compression digests so summaries keep user-critical facts. */
const COMPRESSION_SUMMARY_RUBRIC =
  "SUMMARY_RUBRIC: Preserve verbatim (1) every explicit user number, deadline, path, filename, and must-not/shall constraint, (2) tool-proven facts and repo paths the user depends on, (3) open sub-questions the user still expects answered. Paraphrase filler only; dropping a numbered user requirement is worse than a longer digest.";

function buildCompressionPolicyBlock(policy: string): string {
  const p = policy.trim();
  const parts: string[] = [COMPRESSION_SUMMARY_RUBRIC];
  if (p) parts.push(`COMPRESSION POLICY:\n${p}`);
  return `\n${parts.join("\n\n")}\n`;
}

// ─── Round grouping for compression ──────────────────────────────────────────

interface Round {
  assistantIdx: number;        // index in conv array
  toolResultIdxs: number[];    // indices of tool result messages for this round
  hasError: boolean;           // any tool result was an ERROR
  hasThinkOrPlan: boolean;     // assistant called think/plan (preserve)
  summary: string;             // one-liner summary for compression
  /** Full tool result bodies — used to extract hard facts before summarization. */
  toolResults: Array<{ name: string; body: string }>;
}

/**
 * Extract "rounds" (assistant + tool results) from a conversation array.
 * User messages are not part of rounds.
 */
function extractRounds(conv: Message[]): Round[] {
  const rounds: Round[] = [];

  for (let i = 0; i < conv.length; i++) {
    const m = conv[i];
    if (!m || m.role !== "assistant") continue;

    // Collect tool_call IDs from this assistant message
    const toolCallIds = new Set<string>();
    if ("tool_calls" in m && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Array<{ id: string; function?: { name?: string } }>) {
        toolCallIds.add(tc.id);
      }
    }

    if (toolCallIds.size === 0) continue; // text-only turn, not a "round"

    // Find following tool result messages
    const toolResultIdxs: string[] = [];
    let hasError = false;
    let hasThinkOrPlan = false;
    const resultIdxNumbers: number[] = [];

    // Check tool names for think/plan
    if ("tool_calls" in m && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Array<{ function?: { name?: string } }>) {
        const name = tc.function?.name ?? "";
        if (name === "think" || name === "plan" || name === "hypothesize") hasThinkOrPlan = true;
      }
    }

    for (let j = i + 1; j < conv.length; j++) {
      const r = conv[j];
      if (!r) continue;
      if (r.role === "user" || r.role === "assistant") break; // next round
      if (r.role === "tool" && "tool_call_id" in r) {
        const id = r.tool_call_id as string;
        if (toolCallIds.has(id)) {
          resultIdxNumbers.push(j);
          toolResultIdxs.push(id);
          if (
            typeof r.content === "string" &&
            r.content.startsWith("ERROR:")
          ) {
            hasError = true;
          }
        }
      }
    }

    // Build one-liner summary for this round
    const toolLines: string[] = [];
    const toolResults: Array<{ name: string; body: string }> = [];
    if ("tool_calls" in m && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Array<{ id: string; function?: { name?: string; arguments?: string } }>) {
        const name = tc.function?.name ?? "?";
        const rawArgs = tc.function?.arguments ?? "{}";
        let argsPreview = "";
        try {
          const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
          const first = Object.values(parsed)[0];
          argsPreview =
            typeof first === "string"
              ? `"${first.slice(0, 40)}"`
              : JSON.stringify(first ?? "").slice(0, 40);
        } catch {
          argsPreview = rawArgs.slice(0, 40);
        }
        // Find the result for this tool call
        const resultMsg = conv.find(
          (x) =>
            x &&
            x.role === "tool" &&
            "tool_call_id" in x &&
            x.tool_call_id === tc.id
        );
        let resultPreview = "…";
        if (resultMsg && typeof resultMsg.content === "string") {
          resultPreview = resultMsg.content.slice(0, 60).replace(/\n/g, " ");
          if (resultMsg.content.length > 60) resultPreview += "…";
          toolResults.push({ name, body: resultMsg.content });
        }
        toolLines.push(`  • ${name}(${argsPreview}) → ${resultPreview}`);
      }
    }

    rounds.push({
      assistantIdx: i,
      toolResultIdxs: resultIdxNumbers,
      hasError,
      hasThinkOrPlan,
      summary: toolLines.join("\n"),
      toolResults,
    });
  }

  return rounds;
}

// ─── Tiered context preservation ─────────────────────────────────────────────

function resolveCtxHotRounds(): number {
  const n = parseInt(effectiveHarnessEnvRaw("AGENT_CTX_HOT_ROUNDS") ?? "6", 10);
  return Number.isFinite(n) && n > 0 ? Math.max(2, Math.min(n, 32)) : 6;
}

function resolveCtxWarmRounds(): number {
  const n = parseInt(effectiveHarnessEnvRaw("AGENT_CTX_WARM_ROUNDS") ?? "12", 10);
  return Number.isFinite(n) && n > 0 ? Math.max(0, Math.min(n, 64)) : 12;
}

function isProvenanceEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_CTX_PROVENANCE") !== "0";
}

/** Simple content hash for provenance IDs (djb2 → hex). */
function provenanceHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < Math.min(s.length, 80_000); i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

interface Tier2Block {
  provenanceId: string;
  turnRange: [number, number];
  label: string;
  toolCallsSummary: string[];
  keyFacts: string[];
  summaryText: string;
}

function buildTier2Block(rounds: Round[], baseRoundIndex: number): Tier2Block {
  const toolCallsSummary: string[] = [];
  const structuredFacts: string[] = [];
  const heuristicFacts: string[] = [];
  const summaryParts: string[] = [];

  for (const r of rounds) {
    // Real facts (paths, URLs, ports, counts, key=values) pulled from full tool
    // bodies — preserved verbatim so summarization does not erase hard knowledge.
    for (const tr of r.toolResults) {
      for (const f of extractFactsRaw(tr.name, tr.body)) {
        structuredFacts.push(`${f.kind}: ${f.value}`.slice(0, 160));
      }
    }
    const lines = r.summary.split("\n").filter(Boolean);
    for (const line of lines.slice(0, 4)) {
      toolCallsSummary.push(line.trim());
      // Heuristic fallback: lines containing "→" with a result snippet.
      if (line.includes("→") && line.length > 20) {
        heuristicFacts.push(line.trim().slice(0, 120));
      }
    }
    summaryParts.push(lines[0]?.trim() ?? "(round)");
  }

  const dedupedStructured = [...new Set(structuredFacts)];
  const keyFacts =
    dedupedStructured.length > 0
      ? dedupedStructured.slice(0, 12)
      : heuristicFacts.slice(0, 8);

  const label = summaryParts.slice(0, 3).join("; ").slice(0, 200);
  const content = toolCallsSummary.join("\n");
  const provenanceId = provenanceHash(content + label + baseRoundIndex);

  return {
    provenanceId,
    turnRange: [baseRoundIndex, baseRoundIndex + rounds.length - 1],
    label,
    toolCallsSummary: toolCallsSummary.slice(0, 24),
    keyFacts,
    summaryText: content,
  };
}

function buildTier2SummaryMessage(block: Tier2Block): Message {
  const structured = JSON.stringify({
    __liminal_ctx_tier: 2,
    provenance_id: block.provenanceId,
    turn_range: block.turnRange,
    label: block.label,
    tool_calls_summary: block.toolCallsSummary,
    key_facts: block.keyFacts,
  });
  return {
    role: "user",
    content:
      `[CTX-TIER-2 turns=${block.turnRange[0]}–${block.turnRange[1]} provenance=${block.provenanceId}]\n` +
      "```json\n" + structured + "\n```\n" +
      `Digest: ${block.label}\n` +
      `[Use read_artifact("${block.provenanceId}") to re-expand this block if needed]`,
  };
}

function buildTier3SummaryMessage(rounds: Round[], baseRoundIndex: number): Message {
  const label = rounds
    .map((r) => r.summary.split("\n")[0]?.trim() ?? "(round)")
    .slice(0, 5)
    .join("; ")
    .slice(0, 300);
  const provenanceId = provenanceHash(label + baseRoundIndex + rounds.length);
  return {
    role: "user",
    content:
      `[CTX-TIER-3 turns=${baseRoundIndex}–${baseRoundIndex + rounds.length - 1} provenance=${provenanceId} — far history, collapsed]\n` +
      `Episode: ${label}\n` +
      `[Use recall/search_memory to retrieve details from this period]`,
  };
}

// ─── Context Manager ──────────────────────────────────────────────────────────

export class ContextManager {
  private conversation: Message[] = [];
  private readonly config: ContextConfig;
  /**
   * When set, replaces the content of inceptionMessages[0] in all buildMessages calls.
   * Used by set_persona tool to hot-swap the identity block without rebuilding the harness.
   */
  private personaBlock?: string;
  /** When set, replaces config.inceptionMessages entirely (e.g. child agents after tools registered). */
  private inceptionOverride?: Message[];
  /** Appended to inception protocol (message[1]) from `protocolDynamicBuilder`. */
  private protocolDynamicSuffix = "";
  /** Current turn intent hint forwarded to protocolDynamicBuilder to suppress irrelevant sections. */
  private currentIntentHint = "any";
  /** ZipAct-style bounded summary injected after inception (not stored in conversation). */
  private workingStateBlock = "";
  /** When set, rendered instead of raw workingStateBlock (structured epistemic snapshot). */
  private epistemicState: EpistemicState | null = null;
  /** Bounded execution-state block injected alongside epistemic working state. */
  private executionStateBlock = "";
  /** ACON-style runtime notes appended to compression policy in summary blocks. */
  private compressionNotes: string[] = [];

  constructor(config: ContextConfig) {
    this.config = config;
  }

  /** Recompute protocol suffix from current tool names (root + child registries). */
  refreshProtocolDynamic(toolNames: string[]): void {
    const builder = this.config.protocolDynamicBuilder;
    this.protocolDynamicSuffix = builder ? builder(toolNames, this.currentIntentHint) : "";
  }

  /** Update the per-turn intent hint used to suppress irrelevant protocol sections. */
  setProtocolIntentHint(hint: string): void {
    this.currentIntentHint = hint;
  }

  /** Replace inception messages (used for child harness after scoped tools are registered). */
  setInceptionOverride(messages: Message[] | undefined): void {
    this.inceptionOverride = messages;
  }

  /**
   * Token-aware hints for recall depth and round discipline (domain-agnostic).
   */
  getContextBudgetAdvice(): {
    usageFraction: number;
    headroomFraction: number;
    recommendedRecallK: number;
    suggestedMaxExtraRounds: number;
  } {
    const snap = this.computeSnapshot(this.buildMessagesSync());
    const headroom = Math.max(0, 1 - snap.usageFraction);
    const recommendedRecallK = Math.max(3, Math.min(12, Math.floor(headroom * 24)));
    const suggestedMaxExtraRounds = snap.usageFraction >= 0.75 ? 4 : snap.usageFraction >= 0.55 ? 8 : 16;
    return {
      usageFraction: snap.usageFraction,
      headroomFraction: headroom,
      recommendedRecallK,
      suggestedMaxExtraRounds,
    };
  }

  /** Replace the injected [WORKING STATE] block (empty string clears legacy string only). */
  setWorkingState(block: string): void {
    this.workingStateBlock = block;
    if (this.epistemicState && block.trim()) {
      this.epistemicState = mergeEpistemicState(this.epistemicState, {
        harnessNotes: block.trim().slice(0, 1200),
      });
    }
  }

  getWorkingStateBlock(): string {
    if (this.epistemicState) return renderEpistemicStateBlock(this.epistemicState);
    return this.workingStateBlock;
  }

  /** Start structured epistemic tracking for a new send (root working state). */
  initEpistemicState(goal: string): void {
    this.epistemicState = emptyEpistemicState(goal);
    this.workingStateBlock = "";
  }

  /** Merge fields into the current epistemic snapshot (no-op if not initialized). */
  patchEpistemicState(patch: Partial<EpistemicState>): void {
    if (!this.epistemicState) return;
    this.epistemicState = mergeEpistemicState(this.epistemicState, patch);
  }

  getEpistemicState(): EpistemicState | null {
    return this.epistemicState;
  }

  /** Clear epistemic snapshot (e.g. new session). */
  clearEpistemicState(): void {
    this.epistemicState = null;
  }

  /** Replace the injected [EXECUTION STATE] block (empty clears). */
  setExecutionStateBlock(block: string): void {
    this.executionStateBlock = block.trim().slice(0, 800);
  }

  getExecutionStateBlock(): string {
    return this.executionStateBlock;
  }

  /** Append a line to compression policy (ACON-style guideline evolution via tools). */
  appendCompressionGuidelineNote(note: string): void {
    const t = note.trim();
    if (t) this.compressionNotes.push(t);
  }

  private compressionPolicyPreamble(): string {
    const parts: string[] = [];
    const g = this.config.compressionGuideline?.trim();
    if (g) parts.push(g);
    if (this.compressionNotes.length > 0) {
      parts.push("Runtime compression notes:\n" + this.compressionNotes.join("\n"));
    }
    return parts.join("\n\n");
  }

  /**
   * Replace the identity block (message 0 of inception messages) with a new persona string.
   * Takes effect on the next buildMessages() call.
   */
  setPersonaBlock(block: string): void {
    this.personaBlock = block;
  }

  /** Clear hot-swapped persona so inception message[0] from config is used again. */
  clearPersonaBlock(): void {
    this.personaBlock = undefined;
  }

  /**
   * Returns the effective inception messages, substituting message[0]'s content
   * with the active persona block override (if any).
   */
  getEffectiveInception(): Message[] {
    const base = this.inceptionOverride ?? this.config.inceptionMessages;
    const [first, second, ...tail] = base;
    if (this.inceptionOverride) {
      const firstOut: Message =
        this.personaBlock && first
          ? ({ ...first, content: this.personaBlock } as Message)
          : (first as Message);
      return firstOut ? [firstOut, ...base.slice(1)] : base;
    }
    const firstOut: Message =
      this.personaBlock && first
        ? ({ ...first, content: this.personaBlock } as Message)
        : (first as Message);
    if (!second || second.role !== "system") {
      return firstOut ? [firstOut, ...base.slice(1)] : base;
    }
    const protocolBody =
      typeof second.content === "string"
        ? second.content +
          (this.protocolDynamicSuffix.trim()
            ? `\n\n${this.protocolDynamicSuffix.trim()}`
            : "")
        : second.content;
    const secondOut = { ...second, content: protocolBody } as Message;
    return [firstOut, secondOut, ...tail] as Message[];
  }

  append(message: Message): void {
    this.conversation.push(message);
  }

  /** Alias for append — used by agent.ts for injecting system notes. */
  appendMessage(message: Message): void {
    this.conversation.push(message);
  }

  async buildMessages(): Promise<Message[]> {
    const inception = this.getEffectiveInception();
    const working: Message[] = [];
    const ws = this.epistemicState
      ? renderEpistemicStateBlock(this.epistemicState)
      : this.workingStateBlock.trim();
    if (ws) {
      working.push({
        role: "system",
        content:
          `[WORKING STATE — bounded task snapshot; refreshed each tool round]\n${ws}`,
      });
    }
    const es = this.executionStateBlock.trim();
    if (es) {
      working.push({
        role: "system",
        content: `[EXECUTION STATE — contract budgets and mission progress]\n${es}`,
      });
    }
    let messages = [...inception, ...working, ...this.conversation];

    const snap = this.computeSnapshot(messages);
    if (snap.usageFraction >= this.config.thresholdFraction) {
      messages = await this.compressOldRounds(inception, this.conversation);
    }

    return messages;
  }

  /** Synchronous message build (no semantic compression) — used for token counting only. */
  buildMessagesSync(): Message[] {
    const inception = this.getEffectiveInception();
    const working: Message[] = [];
    const ws = this.epistemicState
      ? renderEpistemicStateBlock(this.epistemicState)
      : this.workingStateBlock.trim();
    if (ws) {
      working.push({
        role: "system",
        content: `[WORKING STATE — bounded task snapshot; refreshed each tool round]\n${ws}`,
      });
    }
    const esBlock = this.executionStateBlock.trim();
    if (esBlock) {
      working.push({
        role: "system",
        content: `[EXECUTION STATE — contract budgets and mission progress]\n${esBlock}`,
      });
    }
    return [...inception, ...working, ...this.conversation];
  }

  snapshot(): ContextSnapshot {
    return this.computeSnapshot(this.buildMessagesSync());
  }

  /**
   * Return the text content of all CONTEXT COMPRESSED summary blocks
   * currently in the conversation — for the recall_compression tool.
   */
  getCompressionSummaries(): string[] {
    const out: string[] = [];
    for (const m of this.conversation) {
      if (m.role !== "user" || typeof m.content !== "string") continue;
      if (m.content.startsWith("[CONTEXT COMPRESSED")) {
        out.push(m.content);
      }
    }
    return out;
  }

  /** Returns the last assistant text message (for subtask result extraction). */
  getLastAssistantMessage(): string | null {
    for (let i = this.conversation.length - 1; i >= 0; i--) {
      const m = this.conversation[i]!;
      if (
        m.role === "assistant" &&
        typeof m.content === "string" &&
        m.content
      ) {
        return m.content;
      }
    }
    return null;
  }

  private computeSnapshot(messages: Message[]): ContextSnapshot {
    const tokenCount = estimateMessagesTokens(messages);
    const usageFraction = tokenCount / this.config.modelMaxTokens;
    return {
      tokenCount,
      maxTokens: this.config.modelMaxTokens,
      usageFraction,
      masked: usageFraction >= this.config.thresholdFraction,
    };
  }

  /**
   * ACON-lite compression with optional tiered preservation (AGENT_CTX_PROVENANCE).
   *
   * Tier 1 (hot): last `AGENT_CTX_HOT_ROUNDS` rounds kept verbatim.
   * Tier 2 (warm): next `AGENT_CTX_WARM_ROUNDS` rounds → structured JSON blocks with provenance IDs.
   * Tier 3 (cold): remaining rounds → single-sentence episode labels.
   *
   * When tiered mode is off (AGENT_CTX_PROVENANCE=0), falls back to the original flat summary.
   */
  private async compressOldRounds(inception: Message[], conv: Message[]): Promise<Message[]> {
    const hotRounds = resolveCtxHotRounds();
    const keepRecent = this.config.keepRecentRounds ?? hotRounds;
    const rounds = extractRounds(conv);

    if (rounds.length <= keepRecent) {
      return this.fallbackMaskObservations(inception, conv);
    }

    const snapBefore = this.computeSnapshot([...inception, ...conv]);

    const compressUpTo = rounds.length - keepRecent;
    const toCompress = rounds.slice(0, compressUpTo).filter(
      (r) => !r.hasError && !r.hasThinkOrPlan
    );

    if (toCompress.length === 0) {
      return this.fallbackMaskObservations(inception, conv);
    }

    // Build set of indices to remove (same for both tiered and flat paths)
    const removeIdxs = new Set<number>();
    for (const round of toCompress) {
      removeIdxs.add(round.assistantIdx);
      for (const idx of round.toolResultIdxs) removeIdxs.add(idx);
    }
    const firstRemovedIdx = Math.min(...removeIdxs);

    // ── Tiered path ────────────────────────────────────────────────────────────
    if (isProvenanceEnabled()) {
      const warmCount = resolveCtxWarmRounds();
      const summaryMessages: Message[] = [];

      if (toCompress.length > warmCount) {
        // Cold tier (oldest rounds beyond warm budget)
        const coldRounds = toCompress.slice(0, toCompress.length - warmCount);
        summaryMessages.push(buildTier3SummaryMessage(coldRounds, 0));

        // Warm tier
        const warmRounds = toCompress.slice(toCompress.length - warmCount);
        if (warmRounds.length > 0) {
          const warmMsg = this.buildWarmTierMessages(warmRounds, coldRounds.length);
          summaryMessages.push(...warmMsg);
          // Write provenance artifacts for warm blocks
          await this.writeProvenanceArtifacts(warmRounds, coldRounds.length);
        }
      } else {
        // All fit in warm tier
        const warmMsg = this.buildWarmTierMessages(toCompress, 0);
        summaryMessages.push(...warmMsg);
        await this.writeProvenanceArtifacts(toCompress, 0);
      }

      const newConv = this.rebuildConv(conv, removeIdxs, firstRemovedIdx, summaryMessages);
      const result = [...inception, ...newConv];
      const snapAfter = this.computeSnapshot(result);
      this.config.onCompressed?.(snapBefore.usageFraction, snapAfter.usageFraction, toCompress.length);
      return result;
    }

    // ── Flat legacy path ───────────────────────────────────────────────────────
    const summaryLines = toCompress.map((r) => r.summary).join("\n");
    let humanDigest = summaryLines;
    if (this.config.semanticSummarizer) {
      try {
        const causal = await this.config.semanticSummarizer(summaryLines);
        if (causal && causal.trim().length > 20) humanDigest = causal.trim();
      } catch {
        /* fall back to raw one-liners */
      }
    }
    const structured = JSON.stringify({
      v: 1,
      kind: "context_compression",
      rounds_compressed: toCompress.length,
      tool_round_summaries: toCompress.map((r) => r.summary.split("\n").filter(Boolean).slice(0, 16)),
    }).slice(0, 14_000);
    const policy = this.compressionPolicyPreamble();
    const policyBlock = buildCompressionPolicyBlock(policy);
    const summaryMsg: Message = {
      role: "user",
      content:
        `[CONTEXT SUMMARY — ${toCompress.length} older round(s) compressed to save space]\n` +
        policyBlock +
        "```json\n" +
        structured +
        "\n```\n" +
        `Human-readable digest:\n${humanDigest}\n` +
        `[End summary — use recall/search_memory/memory_query to access any stored details]`,
    };

    const newConv = this.rebuildConv(conv, removeIdxs, firstRemovedIdx, [summaryMsg]);
    const result = [...inception, ...newConv];
    const snapAfter = this.computeSnapshot(result);
    this.config.onCompressed?.(snapBefore.usageFraction, snapAfter.usageFraction, toCompress.length);
    return result;
  }

  private buildWarmTierMessages(rounds: Round[], baseIdx: number): Message[] {
    // Group into blocks of up to 4 rounds each
    const blockSize = 4;
    const messages: Message[] = [];
    for (let i = 0; i < rounds.length; i += blockSize) {
      const chunk = rounds.slice(i, i + blockSize);
      const block = buildTier2Block(chunk, baseIdx + i);
      messages.push(buildTier2SummaryMessage(block));
    }
    return messages;
  }

  private async writeProvenanceArtifacts(rounds: Round[], baseIdx: number): Promise<void> {
    const blockSize = 4;
    for (let i = 0; i < rounds.length; i += blockSize) {
      const chunk = rounds.slice(i, i + blockSize);
      const block = buildTier2Block(chunk, baseIdx + i);
      const content = JSON.stringify({
        provenance_id: block.provenanceId,
        turn_range: block.turnRange,
        label: block.label,
        tool_calls_summary: block.toolCallsSummary,
        key_facts: block.keyFacts,
        full_summary: block.summaryText,
      }, null, 2);
      try {
        await writeArtifact(block.provenanceId, content);
      } catch {
        /* non-fatal — provenance artifact is advisory */
      }
    }
  }

  private rebuildConv(
    conv: Message[],
    removeIdxs: Set<number>,
    firstRemovedIdx: number,
    summaryMessages: Message[]
  ): Message[] {
    const newConv: Message[] = [];
    let inserted = false;
    for (let i = 0; i < conv.length; i++) {
      if (removeIdxs.has(i)) continue;
      if (!inserted && i >= firstRemovedIdx) {
        newConv.push(...summaryMessages);
        inserted = true;
      }
      newConv.push(conv[i]!);
    }
    if (!inserted) newConv.unshift(...summaryMessages);
    return newConv;
  }

  /**
   * Fallback: blanking behavior for edge cases (too few rounds to summarize).
   * Iterates oldest-first, blanking tool results until usage drops below threshold.
   * (#1 Fix: keepRecent uses config value × 2, not a hardcoded 8)
   */
  private fallbackMaskObservations(
    inception: Message[],
    conv: Message[]
  ): Message[] {
    const masked = conv.map((m) => ({ ...m }));
    // Keep at least keepRecentRounds * 2 messages untouched (1 assistant + 1 tool ≈ 2 per round)
    const keepMessages = (this.config.keepRecentRounds ?? 6) * 2;

    for (let i = 0; i < masked.length - keepMessages; i++) {
      const m = masked[i];
      if (!m) continue;
      if (m.role === "tool" && typeof m.content === "string") {
        masked[i] = {
          ...m,
          content: "[observation masked — context full]",
        } as Message;
        const check = this.computeSnapshot([...inception, ...masked]);
        if (check.usageFraction < this.config.thresholdFraction) break;
      }
    }

    return [...inception, ...masked];
  }

  /**
   * Force immediate compression of old rounds, anchoring the summary with
   * the provided text. Called by the compress_context tool (#5).
   * (#7 Structured Event Log — calls onCompressed callback)
   */
  /**
   * Replace very large tool result bodies outside the last N tool rounds with
   * `[TOOL_BODY_ELIDED …]` + artifact pointer (AGENT_TOOL_BODY_ELIDE=1).
   */
  async elideStaleToolResults(): Promise<void> {
    if (effectiveHarnessEnvRaw("AGENT_TOOL_BODY_ELIDE") !== "1") return;
    const minChars = Math.max(
      2000,
      parseInt(effectiveHarnessEnvRaw("AGENT_TOOL_ELIDE_MIN_CHARS") ?? "10000", 10) || 10_000
    );
    const keepRounds = Math.max(
      1,
      parseInt(effectiveHarnessEnvRaw("AGENT_TOOL_ELIDE_KEEP_ROUNDS") ?? "3", 10) || 3
    );
    const rounds = extractRounds(this.conversation);
    const keepIdx = new Set<number>();
    for (const r of rounds.slice(-keepRounds)) {
      for (const idx of r.toolResultIdxs) keepIdx.add(idx);
    }
    const idToName = new Map<string, string>();
    for (const m of this.conversation) {
      if (m.role !== "assistant" || !("tool_calls" in m) || !Array.isArray(m.tool_calls)) continue;
      for (const tc of m.tool_calls as Array<{ id: string; function?: { name?: string } }>) {
        idToName.set(tc.id, tc.function?.name ?? "?");
      }
    }
    for (let i = 0; i < this.conversation.length; i++) {
      if (keepIdx.has(i)) continue;
      const m = this.conversation[i];
      if (!m || m.role !== "tool" || typeof m.content !== "string") continue;
      if (m.content.startsWith("[TOOL_BODY_ELIDED") || m.content.startsWith("[observation masked"))
        continue;
      if (m.content.startsWith("ERROR:")) continue;
      if (m.content.length < minChars) continue;
      const id = "tool_call_id" in m ? (m.tool_call_id as string) : "";
      const name = idToName.get(id) ?? "tool";
      try {
        const { hash, pointer } = await stashToolBodyElide(m.content);
        const preview = m.content.slice(0, 400).replace(/\n/g, " ");
        this.conversation[i] = {
          ...m,
          content:
            `[TOOL_BODY_ELIDED tool=${name} original_chars=${m.content.length} hash=${hash}]\n` +
            `Full body: ${pointer}\nPreview: ${preview}${m.content.length > 400 ? "…" : ""}`,
        } as Message;
      } catch {
        /* keep original on artifact failure */
      }
    }
  }

  forceCompress(anchorSummary: string): void {
    const inception = this.getEffectiveInception();
    const keepRecent = this.config.keepRecentRounds ?? 6;
    const rounds = extractRounds(this.conversation);

    if (rounds.length <= keepRecent) return; // nothing to compress

    const snapBefore = this.computeSnapshot([...inception, ...this.conversation]);

    const compressUpTo = rounds.length - keepRecent;
    const toCompress = rounds.slice(0, compressUpTo).filter(
      (r) => !r.hasError && !r.hasThinkOrPlan
    );
    if (toCompress.length === 0) return;

    const removeIdxs = new Set<number>();
    for (const round of toCompress) {
      removeIdxs.add(round.assistantIdx);
      for (const idx of round.toolResultIdxs) removeIdxs.add(idx);
    }

    const summaryLines = toCompress.map((r) => r.summary).join("\n");
    const structured = JSON.stringify({
      v: 1,
      kind: "force_compress",
      anchor: anchorSummary.slice(0, 2000),
      tool_round_summaries: toCompress.map((r) => r.summary.split("\n").filter(Boolean).slice(0, 16)),
    }).slice(0, 14_000);
    const policy = this.compressionPolicyPreamble();
    const policyBlock = buildCompressionPolicyBlock(policy);
    const summaryMsg: Message = {
      role: "user",
      content:
        `[CONTEXT COMPRESSED — ${toCompress.length} round(s) summarized]\n` +
        policyBlock +
        "```json\n" +
        structured +
        "\n```\n" +
        `Summary: ${anchorSummary}\nDetails:\n${summaryLines}\n` +
        `[End compressed block — use memory_query / recall for stored detail]`,
    };

    const firstRemovedIdx = Math.min(...removeIdxs);
    const newConv: Message[] = [];
    let inserted = false;
    for (let i = 0; i < this.conversation.length; i++) {
      if (removeIdxs.has(i)) continue;
      if (!inserted && i >= firstRemovedIdx) {
        newConv.push(summaryMsg);
        inserted = true;
      }
      newConv.push(this.conversation[i]!);
    }
    if (!inserted) newConv.unshift(summaryMsg);
    this.conversation = newConv;

    // Notify caller of compression stats (#7)
    const snapAfter = this.computeSnapshot([...inception, ...this.conversation]);
    this.config.onCompressed?.(
      snapBefore.usageFraction,
      snapAfter.usageFraction,
      toCompress.length
    );
  }

  clear(): void {
    this.conversation = [];
    this.workingStateBlock = "";
    this.epistemicState = null;
    this.compressionNotes = [];
    this.protocolDynamicSuffix = "";
    this.inceptionOverride = undefined;
  }
}
