/**
 * Prompt + completion detection for the interactive Agent shell.
 *
 * Pure string logic shared by agent_shell_session.ts and terminal_shell_runtime.ts.
 * Strategy: platform prompt regexes bootstrap detection; the actual prompt line is
 * learned at boot and re-learned after every command so custom prompts (starship,
 * venv, oh-my-zsh) keep working. Command completion additionally requires a real
 * line break, so a ConPTY prompt repaint can never be mistaken for "command done".
 */

export type ShellFlavor = "powershell" | "cmd" | "posix";

export function detectShellFlavor(): ShellFlavor {
  if (process.platform !== "win32") return "posix";
  return process.env["AGENT_SHELL"]?.trim().toLowerCase() === "cmd" ? "cmd" : "powershell";
}

// Order matters: DCS/OSC bodies may contain CSI-looking bytes; OSC may be cut at a
// readTail boundary (no terminator), hence the optional terminator.
const DCS_LIKE_RE = /\x1b[PX^_][\s\S]*?(?:\x1b\\|$)/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const CHARSET_RE = /\x1b[()][0-9A-Za-z]/g;
const SINGLE_ESC_RE = /\x1b[@-Z\\^_=><]/g;

export function stripAnsi(raw: string): string {
  return raw
    .replace(DCS_LIKE_RE, "")
    .replace(OSC_RE, "")
    .replace(CSI_RE, "")
    .replace(CHARSET_RE, "")
    .replace(SINGLE_ESC_RE, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

export function normalizeNewlines(plain: string): string {
  return plain.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function lastNonEmptyLine(plain: string): string {
  const lines = normalizeNewlines(plain).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    if (t) return t;
  }
  return "";
}

const PS_PROMPT_RE = /^(\([^)]*\)\s*)?PS\s[^>]*>$/;
const CMD_PROMPT_RE = /^(\([^)]*\)\s*)?[A-Za-z]:\\[^>]*>$/;
const PS_ECHO_RE = /^(\([^)]*\)\s*)?PS\s[^>]*>\s\S/;
const CMD_ECHO_RE = /^(\([^)]*\)\s*)?[A-Za-z]:\\[^>]*>\s?\S/;

/** Whole-line prompt check (line must already be trimmed of surrounding noise). */
export function looksLikePromptLine(rawLine: string, flavor: ShellFlavor): boolean {
  const t = rawLine.trim();
  if (!t || t.length > 200) return false;
  if (flavor === "powershell") return PS_PROMPT_RE.test(t);
  if (flavor === "cmd") return CMD_PROMPT_RE.test(t);
  // POSIX: prompt glyph at end plus prompt-shaped context. Deliberately rejects
  // progress output like "100%" and npm's "> script" lines.
  if (!/[#$%❯]$/.test(t)) return false;
  if (/^[#$%❯]$/.test(t)) return true;
  const body = t.slice(0, -1).trim();
  if (/^[\d.,\s]+$/.test(body)) return false; // "100%", "1,024 $" …
  if (/[@~]/.test(body) || /[/:]/.test(body)) return true; // user@host:~, paths
  if (/^\([^)]*\)/.test(t)) return true; // (venv) …
  return /^[\w.-]{1,24}$/.test(body); // bash-5.1$, host%
}

/** Line-continuation prompt: the shell wants more input (unbalanced quote etc.). */
export function isContinuationPromptLine(rawLine: string, flavor: ShellFlavor): boolean {
  const t = rawLine.trim();
  if (flavor === "powershell") return t === ">>";
  if (flavor === "posix") return t === ">";
  return false;
}

/**
 * Per-session prompt matcher. Regexes bootstrap detection; once the shell is
 * known-idle the actual prompt line is learned and matched directly (exact, or
 * same head + same trailing glyph for cwd-dependent prompts).
 */
export class PromptDetector {
  private learned: string | null = null;

  constructor(readonly flavor: ShellFlavor = detectShellFlavor()) {}

  get learnedPrompt(): string | null {
    return this.learned;
  }

  reset(): void {
    this.learned = null;
  }

  /** Remember the current prompt line — call only when the shell is known-idle. */
  learnFrom(rawOrPlain: string): void {
    const line = lastNonEmptyLine(stripAnsi(rawOrPlain));
    if (!line || line.length > 200) return;
    if (isContinuationPromptLine(line, this.flavor)) return;
    this.learned = line;
  }

  isPromptLine(line: string): boolean {
    const t = line.trim();
    if (!t) return false;
    if (this.matchesLearned(t)) return true;
    return looksLikePromptLine(t, this.flavor);
  }

  /** True when `line` is the echo of typed input at a prompt ("PS C:\x> git st…"). */
  isEchoedInputLine(line: string): boolean {
    const t = line.trim();
    if (!t) return false;
    if (this.learned && t.startsWith(this.learned) && t.length > this.learned.length) {
      return true;
    }
    if (this.flavor === "powershell") return PS_ECHO_RE.test(t);
    if (this.flavor === "cmd") return CMD_ECHO_RE.test(t);
    return false;
  }

  isPromptAtEnd(plain: string): boolean {
    return this.isPromptLine(lastNonEmptyLine(plain));
  }

  isContinuationAtEnd(plain: string): boolean {
    return isContinuationPromptLine(lastNonEmptyLine(plain), this.flavor);
  }

  private matchesLearned(t: string): boolean {
    const l = this.learned;
    if (!l) return false;
    if (t === l) return true;
    // cwd-sensitive prompts ("PS C:\a>" → "PS C:\a\b>"): same head, same glyph.
    return (
      l.length >= 3 &&
      t.length >= 3 &&
      t.length <= 160 &&
      t.slice(0, 3) === l.slice(0, 3) &&
      t.slice(-1) === l.slice(-1)
    );
  }
}

export type CompletionState = "busy" | "done" | "continuation";

/**
 * A command is complete only when (a) at least one real line break arrived after
 * the input echo — a bare prompt repaint never contains "\n" — and (b) the last
 * non-empty line is a prompt again. `sawNewline` lets callers track line breaks
 * across the full stream when only a tail slice is passed in.
 */
export function evaluateCommandCompletion(
  plainSlice: string,
  detector: PromptDetector,
  opts?: { sawNewline?: boolean }
): CompletionState {
  if (!plainSlice) return "busy";
  const newlineSeen = opts?.sawNewline ?? plainSlice.includes("\n");
  if (newlineSeen && detector.isPromptAtEnd(plainSlice)) return "done";
  if (detector.isContinuationAtEnd(plainSlice)) return "continuation";
  return "busy";
}

/**
 * Tool-facing output: drop prompt lines and the echoed input line; keep everything
 * else verbatim — including bare-number lines, since the exit code comes from a
 * separate probe, never from scraping output.
 */
export function extractCommandOutput(rawSlice: string, detector: PromptDetector): string {
  const plain = normalizeNewlines(stripAnsi(rawSlice));
  const kept: string[] = [];
  for (const line of plain.split("\n")) {
    if (!line.trim()) {
      kept.push(line);
      continue;
    }
    if (detector.isPromptLine(line)) continue;
    if (detector.isEchoedInputLine(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").replace(/^\n+/, "").trimEnd();
}

/** Visible, single-line exit-status probe typed into the shell after a command. */
export function buildExitProbe(flavor: ShellFlavor): string {
  if (flavor === "cmd") return "echo %ERRORLEVEL%";
  if (flavor === "powershell") {
    // $? reflects the *previous* command (cmdlets AND natives); $LASTEXITCODE alone
    // is stale after cmdlet failures and null in fresh sessions.
    return "if($?){0}elseif($LASTEXITCODE){$LASTEXITCODE}else{1}";
  }
  return "echo $?";
}

/** Parse the probe's printed value: last standalone integer line in the slice. */
export function parseExitProbeValue(rawSlice: string): number | null {
  const lines = normalizeNewlines(stripAnsi(rawSlice)).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    if (/^-?\d{1,10}$/.test(t)) {
      const n = parseInt(t, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
