export type InputShortcutAction =
  | "send"
  | "insert_newline"
  | "history_prev"
  | "history_next"
  | "clear_draft"
  | "clear_session"
  | "clear_transient_ui"
  | "none";

export interface InputShortcutEvent {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}

export interface InputShortcutContext {
  canSend: boolean;
  busy: boolean;
  hasTransientUi?: boolean;
  cursorAtStart?: boolean;
  cursorAtEnd?: boolean;
}

function hasPrimaryModifier(ev: InputShortcutEvent): boolean {
  return Boolean(ev.ctrlKey || ev.metaKey);
}

export function resolveInputShortcut(
  ev: InputShortcutEvent,
  ctx: InputShortcutContext
): InputShortcutAction {
  const key = ev.key;
  const shift = Boolean(ev.shiftKey);
  const alt = Boolean(ev.altKey);
  const primary = hasPrimaryModifier(ev);

  if (key === "Escape") {
    if (ctx.hasTransientUi) return "clear_transient_ui";
    return "none";
  }

  if (primary && !shift && !alt && (key === "k" || key === "K")) return "clear_draft";
  // Session clear intentionally requires Shift so Ctrl/Cmd+L (browser address bar) does not wipe the chat.
  if (primary && shift && !alt && (key === "l" || key === "L")) return "clear_session";

  if (key === "Enter") {
    if (ev.isComposing) return "none";
    if (shift) return "insert_newline";
    if (ctx.busy || !ctx.canSend) return "none";
    return "send";
  }

  if (primary && !shift && !alt && key === "Enter") {
    if (ctx.busy || !ctx.canSend) return "none";
    return "send";
  }

  if (key === "ArrowUp" && ctx.cursorAtStart) return "history_prev";
  if (key === "ArrowDown" && ctx.cursorAtEnd) return "history_next";

  return "none";
}

// ─── Implicit follow-up feedback (outcome learning) ───────────────────────────
// Classify the user's *next* message after an assistant turn as weak supervision
// for whether the prior answer actually helped — zero LLM cost.

export type ImplicitFollowUpKind =
  | "correction"
  | "retry"
  | "thanks"
  | "topic_change"
  | "neutral";

export interface ImplicitFollowUpFeedback {
  kind: ImplicitFollowUpKind;
  /** 0–1 confidence in the label. */
  confidence: number;
  /**
   * Target outcome score for this label, or null when the message carries no
   * implicit signal (neutral).
   */
  implicitScore: number | null;
}

const CORRECTION_PATTERNS: RegExp[] = [
  /^\s*(no|nope|wrong|incorrect|not right|that's wrong|that is wrong|you'?re wrong)\b/i,
  /\b(no,?\s+i\s+(meant|said|wanted|asked))\b/i,
  /\b(i\s+meant|what\s+i\s+meant|not\s+what\s+i)\b/i,
  /\b(that('?s| is)\s+(not|wrong|incorrect|off))\b/i,
  /\b(you\s+missed|you\s+ignored|you\s+forgot|didn'?t\s+(work|fix|do))\b/i,
  /\b(still\s+(broken|wrong|failing|not working))\b/i,
  /\bfix\s+(this|that|it)\b/i,
];

const RETRY_PATTERNS: RegExp[] = [
  /\b(try\s+again|redo|retry|one\s+more\s+time|do\s+it\s+again|run\s+it\s+again)\b/i,
  /\b(please\s+)?(fix\s+and\s+retry|run\s+again)\b/i,
  /\bgive\s+it\s+another\s+(try|shot)\b/i,
];

const THANKS_PATTERNS: RegExp[] = [
  /^\s*(thanks|thank\s+you|thx|ty)\b[!.,]?\s*$/i,
  /\b(thanks|thank\s+you|perfect|great\s+job|awesome|that\s+works|looks\s+good|exactly\s+what)\b/i,
  /\b(nice|lovely|brilliant|spot\s+on)\b/i,
];

const TOPIC_CHANGE_PATTERNS: RegExp[] = [
  /\b(anyway|by\s+the\s+way|btw|new\s+question|different\s+(task|topic|question))\b/i,
  /\b(switching\s+gears|moving\s+on|unrelated|off\s+topic)\b/i,
  /\b(let'?s\s+(talk|discuss|work)\s+on\s+something\s+else)\b/i,
];

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function hasThanksButClause(text: string): boolean {
  return /\b(thanks|thank you|thx)\b.+\b(but|however|except|although)\b/i.test(text);
}

/**
 * Classify a follow-up user message as implicit feedback on the prior assistant turn.
 * Corrections/retries → strong negative; thanks/topic change → positive; else neutral.
 */
export function classifyImplicitFollowUpFeedback(message: string): ImplicitFollowUpFeedback {
  const m = message.replace(/\s+/g, " ").trim();
  if (!m || m.length < 2) {
    return { kind: "neutral", confidence: 0, implicitScore: null };
  }

  if (matchesAny(m, CORRECTION_PATTERNS)) {
    return { kind: "correction", confidence: 0.9, implicitScore: 0.12 };
  }
  if (matchesAny(m, RETRY_PATTERNS)) {
    return { kind: "retry", confidence: 0.85, implicitScore: 0.22 };
  }
  if (matchesAny(m, THANKS_PATTERNS) && !hasThanksButClause(m)) {
    return { kind: "thanks", confidence: 0.8, implicitScore: 0.88 };
  }
  if (matchesAny(m, TOPIC_CHANGE_PATTERNS)) {
    return { kind: "topic_change", confidence: 0.65, implicitScore: 0.78 };
  }

  return { kind: "neutral", confidence: 0, implicitScore: null };
}

