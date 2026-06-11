/**
 * OSC 133 shell-integration injection for interactive agent PTYs.
 *
 * The shell itself emits invisible escape sequences around every prompt and
 * command (the same protocol VS Code / Windows Terminal / WezTerm use):
 *
 *   ESC]133;A ST   — prompt is being painted
 *   ESC]133;B ST   — prompt finished; command input starts here
 *   ESC]133;D;<exit> ST — previous command finished with this exit code
 *
 * With these markers the harness never guesses: command completion is "the D
 * marker arrived", the exit code rides on the marker, and no probe command is
 * ever typed into the user's terminal. Terminals that don't understand OSC 133
 * ignore it, so nothing is visible in the UI.
 *
 * Injection is per shell flavor:
 *  - PowerShell (5.1 / 7): a `prompt` function defined via -Command.
 *  - cmd.exe: PROMPT env var with $E escapes (A/B only — cmd cannot embed
 *    ERRORLEVEL in PROMPT, so the exit code still needs a probe).
 *  - bash: --rcfile shim that sources the user's rc, then sets PROMPT_COMMAND/PS1.
 *  - zsh: ZDOTDIR shim whose .zshrc sources the user's, then hooks precmd.
 *  - fish/other: no injection (callers fall back to prompt detection).
 */
import os from "node:os";
import path from "node:path";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

export interface InteractivePtyLaunch {
  executable: string;
  args: string[];
  /** Extra environment to merge into the PTY's env (e.g. cmd PROMPT). */
  env?: Record<string, string>;
  /**
   * Whether OSC 133 markers will carry the real exit code on D.
   * cmd.exe emits A/B only; callers keep an exit probe for it.
   */
  exitCodeOnMarker: boolean;
  /** Whether any OSC 133 injection was applied at all. */
  integrationInjected: boolean;
}

const ESC = "\x1b";
const BEL = "\x07";

/**
 * PowerShell prompt function emitting D;<code>, A, prompt text, B.
 * `$?` / `$LASTEXITCODE` are captured first so the marker reflects the user's
 * command, not our own statements. Single line so it can ride -Command argv.
 */
export function buildPowerShellIntegrationScript(): string {
  return [
    "function global:prompt {",
    "$q = $global:?;",
    "$lec = $global:LASTEXITCODE;",
    "$c = if ($q) { 0 } elseif ($lec -is [int] -and $lec -ne 0) { $lec } else { 1 };",
    "$e = [char]27; $b = [char]7;",
    '"$e]133;D;$c$b$e]133;A$b" + "PS $($executionContext.SessionState.Path.CurrentLocation)> " + "$e]133;B$b"',
    "}",
  ].join(" ");
}

/** cmd.exe PROMPT with $E escapes: A marker, normal $P$G prompt, B marker. */
export function buildCmdIntegrationPrompt(): string {
  // $E = ESC; "$E]133;A$E\" renders ESC ] 133;A ESC \ (OSC ... ST).
  return `$E]133;A$E\\$P$G$E]133;B$E\\`;
}

function bashIntegrationBody(): string {
  return [
    "# Liminal OSC 133 shell integration (auto-generated; safe to delete)",
    '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"',
    "__liminal_osc133_prompt() {",
    "  local code=$?",
    `  printf '${ESC}]133;D;%s${BEL}${ESC}]133;A${BEL}' "$code"`,
    "}",
    // Append (don't replace) so user PROMPT_COMMAND keeps working.
    'PROMPT_COMMAND="__liminal_osc133_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
    `PS1="\${PS1}\\[${ESC}]133;B${BEL}\\]"`,
    "",
  ].join("\n");
}

function zshIntegrationBody(userZdotdir: string): string {
  return [
    "# Liminal OSC 133 shell integration (auto-generated; safe to delete)",
    `export ZDOTDIR=${JSON.stringify(userZdotdir)}`,
    '[ -f "$ZDOTDIR/.zshrc" ] && . "$ZDOTDIR/.zshrc"',
    "__liminal_osc133_precmd() {",
    "  local code=$?",
    `  printf '${ESC}]133;D;%s${BEL}${ESC}]133;A${BEL}' "$code"`,
    "}",
    "autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd __liminal_osc133_precmd",
    `PS1="\${PS1}%{${ESC}]133;B${BEL}%}"`,
    "",
  ].join("\n");
}

let cachedBashRc: string | null = null;
let cachedZshDir: string | null = null;

function integrationDir(): string {
  const dir = path.join(os.tmpdir(), "liminal-shell-integration");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write (once per process) the bash rcfile shim; returns its path. */
export function ensureBashIntegrationRcFile(): string {
  if (cachedBashRc && existsSync(cachedBashRc)) return cachedBashRc;
  const file = path.join(integrationDir(), "bashrc.liminal");
  writeFileSync(file, bashIntegrationBody(), "utf8");
  cachedBashRc = file;
  return file;
}

/** Write (once per process) the zsh ZDOTDIR shim; returns the shim dir. */
export function ensureZshIntegrationDir(): string {
  if (cachedZshDir && existsSync(path.join(cachedZshDir, ".zshrc"))) return cachedZshDir;
  const dir = path.join(integrationDir(), "zdotdir");
  mkdirSync(dir, { recursive: true });
  const userZdotdir = process.env["ZDOTDIR"]?.trim() || os.homedir();
  writeFileSync(path.join(dir, ".zshrc"), zshIntegrationBody(userZdotdir), "utf8");
  cachedZshDir = dir;
  return dir;
}
