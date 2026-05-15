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

