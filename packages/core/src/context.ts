import type { Message, ContextConfig, ContextSnapshot } from "./types.js";

// ─── Round grouping for compression ──────────────────────────────────────────

interface Round {
  assistantIdx: number;        // index in conv array
  toolResultIdxs: number[];    // indices of tool result messages for this round
  hasError: boolean;           // any tool result was an ERROR
  hasThinkOrPlan: boolean;     // assistant called think/plan (preserve)
  summary: string;             // one-liner summary for compression
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
        if (name === "think" || name === "plan") hasThinkOrPlan = true;
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
    });
  }

  return rounds;
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
  /** ZipAct-style bounded summary injected after inception (not stored in conversation). */
  private workingStateBlock = "";
  /** ACON-style runtime notes appended to compression policy in summary blocks. */
  private compressionNotes: string[] = [];

  constructor(config: ContextConfig) {
    this.config = config;
  }

  /** Replace the injected [WORKING STATE] block (empty string clears). */
  setWorkingState(block: string): void {
    this.workingStateBlock = block;
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
    const base = this.config.inceptionMessages;
    if (!this.personaBlock) return base;
    const [first, ...rest] = base;
    if (!first) return base;
    return [{ ...first, content: this.personaBlock } as Message, ...rest];
  }

  append(message: Message): void {
    this.conversation.push(message);
  }

  /** Alias for append — used by agent.ts for injecting system notes. */
  appendMessage(message: Message): void {
    this.conversation.push(message);
  }

  buildMessages(): Message[] {
    const inception = this.getEffectiveInception();
    const working: Message[] = [];
    const ws = this.workingStateBlock.trim();
    if (ws) {
      working.push({
        role: "user",
        content:
          `[WORKING STATE — bounded task snapshot; refreshed each tool round]\n${ws}`,
      });
    }
    let messages = [...inception, ...working, ...this.conversation];

    const snap = this.computeSnapshot(messages);
    if (snap.usageFraction >= this.config.thresholdFraction) {
      messages = this.compressOldRounds(inception, this.conversation);
    }

    return messages;
  }

  snapshot(): ContextSnapshot {
    return this.computeSnapshot(this.buildMessages());
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
    const tokenCount = this.estimateTokens(messages);
    const usageFraction = tokenCount / this.config.modelMaxTokens;
    return {
      tokenCount,
      maxTokens: this.config.modelMaxTokens,
      usageFraction,
      masked: usageFraction >= this.config.thresholdFraction,
    };
  }

  private estimateTokens(messages: Message[]): number {
    const total = messages.reduce((sum, m) => {
      if (typeof m.content === "string") return sum + m.content.length;
      if (Array.isArray(m.content)) {
        return (
          sum +
          (m.content as Array<{ type: string; text?: string }>).reduce(
            (s, p) => s + (typeof p.text === "string" ? p.text.length : 0),
            0
          )
        );
      }
      return sum;
    }, 0);
    return Math.ceil(total / 4);
  }

  /**
   * ACON-lite compression: instead of blanking individual tool results,
   * collapse old rounds into a structured summary block.
   *
   * Preserves: all user messages, error results, think/plan rounds,
   * and the most recent keepRecentRounds complete rounds.
   *
   * (#1 Fix Fallback Masking — KEEP_RECENT_ROUNDS unified here)
   * (#7 Structured Event Log — calls onCompressed callback)
   */
  private compressOldRounds(inception: Message[], conv: Message[]): Message[] {
    const keepRecent = this.config.keepRecentRounds ?? 6;
    const rounds = extractRounds(conv);

    if (rounds.length <= keepRecent) {
      // Fallback: if too few rounds to compress, do simple blanking
      return this.fallbackMaskObservations(inception, conv);
    }

    const snapBefore = this.computeSnapshot([...inception, ...conv]);

    // Identify rounds eligible for compression (not recent, not error, not think/plan)
    const compressUpTo = rounds.length - keepRecent;
    const toCompress = rounds.slice(0, compressUpTo).filter(
      (r) => !r.hasError && !r.hasThinkOrPlan
    );

    if (toCompress.length === 0) {
      return this.fallbackMaskObservations(inception, conv);
    }

    // Build set of indices to remove
    const removeIdxs = new Set<number>();
    for (const round of toCompress) {
      removeIdxs.add(round.assistantIdx);
      for (const idx of round.toolResultIdxs) {
        removeIdxs.add(idx);
      }
    }

    // Build summary message
    const summaryLines = toCompress.map((r) => r.summary).join("\n");
    const policy = this.compressionPolicyPreamble();
    const policyBlock = policy
      ? `\nCOMPRESSION POLICY:\n${policy}\n`
      : "";
    const summaryMsg: Message = {
      role: "user",
      content:
        `[CONTEXT SUMMARY — ${toCompress.length} older round(s) compressed to save space]\n` +
        policyBlock +
        summaryLines +
        `\n[End summary — use recall/search_memory to access any stored details]`,
    };

    // Reconstruct: insert summary before the first kept message, remove compressed messages
    const firstRemovedIdx = Math.min(...removeIdxs);
    const newConv: Message[] = [];
    let summaryInserted = false;

    for (let i = 0; i < conv.length; i++) {
      if (removeIdxs.has(i)) continue;
      if (!summaryInserted && i >= firstRemovedIdx) {
        newConv.push(summaryMsg);
        summaryInserted = true;
      }
      newConv.push(conv[i]!);
    }
    if (!summaryInserted) newConv.unshift(summaryMsg);

    const result = [...inception, ...newConv];

    // Notify caller of compression stats (#7)
    const snapAfter = this.computeSnapshot(result);
    this.config.onCompressed?.(
      snapBefore.usageFraction,
      snapAfter.usageFraction,
      toCompress.length
    );

    return result;
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
    const policy = this.compressionPolicyPreamble();
    const policyBlock = policy ? `\nCOMPRESSION POLICY:\n${policy}\n` : "";
    const summaryMsg: Message = {
      role: "user",
      content:
        `[CONTEXT COMPRESSED — ${toCompress.length} round(s) summarized]\n` +
        policyBlock +
        `Summary: ${anchorSummary}\nDetails:\n${summaryLines}\n` +
        `[End compressed block]`,
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
    this.compressionNotes = [];
  }
}
