import { effectiveHarnessEnvRaw } from "@liminal/core";

export function shellToolOutputMaxChars(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_SHELL_TOOL_OUTPUT_MAX_CHARS")?.trim();
  const n = parseInt(raw ?? "12000", 10);
  return Number.isFinite(n) && n > 0 ? n : 12_000;
}

/** PATH dumps and other single-line noise should not flood chat tool cards. */
export function isNoisyShellOutputLine(line: string): boolean {
  const t = line.trim();
  if (t.length > 2_000) return true;
  const semis = (t.match(/;/g) ?? []).length;
  if (semis >= 8 && t.length > 120) return true;
  const pathSegments = (t.match(/[A-Za-z]:\\|Program Files|\/usr\/|\/bin\//gi) ?? []).length;
  if (pathSegments >= 5 && t.length > 120) return true;
  return false;
}

/** Trim tool-facing shell output; full text stays in the Terminal panel. */
export function cleanShellOutputForTool(raw: string): string {
  const lines = raw.split("\n");
  const kept: string[] = [];
  let omitted = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    if (/^Windows PowerShell/i.test(trimmed) || /^Copyright \(C\)/i.test(trimmed)) {
      continue;
    }
    if (isNoisyShellOutputLine(line)) {
      omitted++;
      continue;
    }
    if (/;\s*\$LASTEXITCODE\s*$/i.test(trimmed) || /&\s*echo\s+%ERRORLEVEL%\s*$/i.test(trimmed)) {
      continue;
    }
    kept.push(line);
  }

  let out = kept.join("\n").trimEnd();
  if (omitted > 0) {
    out +=
      (out ? "\n" : "") +
      `[${omitted} very long line(s) omitted from tool output — see Terminal panel for full scrollback]`;
  }
  return out;
}

export function capShellToolOutput(body: string): string {
  const cleaned = cleanShellOutputForTool(body);
  const max = shellToolOutputMaxChars();
  if (cleaned.length <= max) return cleaned;

  const headBudget = Math.floor(max * 0.65);
  const tailBudget = Math.floor(max * 0.25);
  const head = cleaned.slice(0, headBudget);
  const tail = cleaned.slice(-tailBudget);
  const omitted = cleaned.length - head.length - tail.length;
  return (
    `${head}\n` +
    `… [${omitted} chars omitted — full output in Terminal panel] …\n` +
    tail
  );
}
