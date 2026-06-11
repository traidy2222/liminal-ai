/**
 * OSC 133 marker tracking for the agent terminal.
 *
 * Core injects shell integration at PTY launch (core/shell_integration_launch.ts);
 * this module parses the resulting marker stream on the tools side:
 *
 *   ESC]133;A (BEL|ESC\)        — prompt start
 *   ESC]133;B (BEL|ESC\)        — prompt end / input starts
 *   ESC]133;C (BEL|ESC\)        — command pre-exec (optional, unused)
 *   ESC]133;D;<exit> (BEL|ESC\) — command finished with exit code
 *
 * Pure string logic, no timers — unit-testable. Sequences may be split across
 * PTY chunks, so the tracker carries an unterminated tail between feeds.
 */

export interface Osc133Event {
  kind: "A" | "B" | "C" | "D";
  /** Exit code carried on D markers (null when absent — e.g. cmd.exe). */
  exitCode: number | null;
  /** Absolute offset of the marker start in the total fed stream. */
  offset: number;
}

const MARKER_RE = /\x1b\]133;([A-D])(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g;
/** Longest prefix of an unterminated marker we must keep between chunks. */
const MAX_CARRY = 64;

export class Osc133Tracker {
  /** Total chars fed so far (offsets are relative to this stream). */
  private fed = 0;
  /** Unconsumed tail that may contain a split marker. */
  private carry = "";
  /** Offset in the total stream where `carry` begins. */
  private carryOffset = 0;
  private events: Osc133Event[] = [];

  /** Parse a PTY chunk; returns any complete marker events found. */
  feed(chunk: string): Osc133Event[] {
    const s = this.carry + chunk;
    const base = this.carryOffset;
    this.fed += chunk.length;

    const found: Osc133Event[] = [];
    MARKER_RE.lastIndex = 0;
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = MARKER_RE.exec(s)) !== null) {
      const kind = m[1] as Osc133Event["kind"];
      let exitCode: number | null = null;
      if (kind === "D" && m[2] !== undefined && /^-?\d{1,10}$/.test(m[2].trim())) {
        exitCode = parseInt(m[2].trim(), 10);
      }
      found.push({ kind, exitCode, offset: base + m.index });
      lastEnd = m.index + m[0].length;
    }

    // Keep only a tail that could still hold a split marker start.
    const rest = s.slice(lastEnd);
    const escIdx = rest.lastIndexOf("\x1b");
    if (escIdx >= 0 && rest.length - escIdx <= MAX_CARRY) {
      this.carry = rest.slice(escIdx);
      this.carryOffset = base + lastEnd + escIdx;
    } else {
      this.carry = "";
      this.carryOffset = base + s.length;
    }

    this.events.push(...found);
    if (this.events.length > 512) this.events = this.events.slice(-256);
    return found;
  }

  get totalFed(): number {
    return this.fed;
  }

  get lastEvent(): Osc133Event | null {
    return this.events.length ? this.events[this.events.length - 1]! : null;
  }

  /** Any marker seen at all → integration is active for this session. */
  get integrationActive(): boolean {
    return this.events.length > 0;
  }

  /** Shell is sitting at an input prompt (last marker is B). */
  get atPrompt(): boolean {
    return this.lastEvent?.kind === "B";
  }

  /** Last D event (most recent command completion). */
  get lastDone(): Osc133Event | null {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i]!.kind === "D") return this.events[i]!;
    }
    return null;
  }
}

/** Remove OSC 133 markers from raw output (other ANSI handled elsewhere). */
export function stripOsc133(raw: string): string {
  return raw.replace(/\x1b\]133;[A-D](?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g, "");
}

/**
 * Drop the echoed command line(s) from the start of a command's plain-text
 * output slice. The slice begins exactly at the input echo (it was captured
 * from the moment the command was written, with the prompt already painted).
 * Echo may span multiple lines for multi-line commands, with continuation
 * prompts ('>> ', '> ') prefixed by the shell.
 */
export function stripEchoedCommand(plainSlice: string, command: string): string {
  const lines = plainSlice.split("\n");
  const target = command.replace(/\s+/g, "");
  let consumed = "";
  let drop = 0;

  for (let i = 0; i < lines.length && drop < 24; i++) {
    let line = lines[i]!.replace(/^(>>|>)\s?/, "");
    if (i === 0) {
      // PSReadLine may repaint "PS C:\repo> " before the echoed input —
      // strip a prompt-shaped prefix when that makes the echo match.
      const stripped = line.replace(/^.*?[>$%#❯]\s/, "");
      const rawKey = line.replace(/\s+/g, "");
      if (!target.startsWith(rawKey) && stripped !== line) {
        const strippedKey = stripped.replace(/\s+/g, "");
        if (target.startsWith(strippedKey) || strippedKey.startsWith(target)) {
          line = stripped;
        }
      }
    }
    consumed += line.replace(/\s+/g, "");
    drop = i + 1;
    if (consumed.length >= target.length) break;
    // Echo must remain a prefix of the command; otherwise it's real output.
    if (!target.startsWith(consumed)) {
      drop = i === 0 ? 1 : i; // always drop at least the first (echo) line
      break;
    }
  }

  return lines.slice(Math.max(drop, 1)).join("\n").replace(/^\n+/, "").trimEnd();
}
