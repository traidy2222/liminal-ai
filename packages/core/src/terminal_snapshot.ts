import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

export interface TerminalSnapshotSummary {
  source: "external_terminal_snapshot";
  entries: Array<{
    id: string;
    pid?: number;
    cwd?: string;
    lastCommand?: string;
    lastExitCode?: number;
    running?: boolean;
    outputPreview: string[];
  }>;
}

interface ParsedTerminalHeader {
  pid?: number;
  cwd?: string;
  lastCommand?: string;
  lastExitCode?: number;
}

function parseHeader(raw: string): ParsedTerminalHeader {
  const out: ParsedTerminalHeader = {};
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return out;
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === "pid") out.pid = Number.parseInt(value, 10);
    if (key === "cwd") out.cwd = value;
    if (key === "last_command") out.lastCommand = value;
    if (key === "last_exit_code") out.lastExitCode = Number.parseInt(value, 10);
  }
  return out;
}

function redactSensitive(text: string): string {
  return text
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*["']?([^\s"']+)/gi, "$1=[REDACTED]")
    .replace(/\b(sk-[a-zA-Z0-9_-]{16,})\b/g, "[REDACTED]")
    .replace(/\bghp_[a-zA-Z0-9]{20,}\b/g, "[REDACTED]");
}

function clampLine(line: string, max = 160): string {
  const txt = line.trim();
  if (txt.length <= max) return txt;
  return `${txt.slice(0, max - 1)}…`;
}

function parseOutputPreview(raw: string, maxLines: number): string[] {
  const body = raw.replace(/^---[\s\S]*?---\r?\n?/, "");
  const lines = body
    .split(/\r?\n/)
    .map((l) => clampLine(redactSensitive(l)))
    .filter((l) => l.length > 0);
  return lines.slice(-maxLines);
}

function isAllowedDir(target: string, allowRoots: string[]): boolean {
  const normalizedTarget = path.resolve(target).toLowerCase();
  return allowRoots.some((root) => {
    const normalizedRoot = path.resolve(root).toLowerCase();
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
  });
}

export async function gatherExternalTerminalSnapshots(): Promise<TerminalSnapshotSummary | null> {
  if (process.env["AGENT_EXTERNAL_TERMINAL_CONTEXT"] !== "1") return null;
  const terminalDir = process.env["AGENT_EXTERNAL_TERMINAL_DIR"]?.trim();
  if (!terminalDir) return null;

  const allowRootsRaw = process.env["AGENT_EXTERNAL_TERMINAL_ALLOW_ROOTS"]?.trim() || "";
  const allowRoots = allowRootsRaw
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowRoots.length === 0 || !isAllowedDir(terminalDir, allowRoots)) return null;

  const maxFiles = Math.max(1, Math.min(20, Number.parseInt(process.env["AGENT_EXTERNAL_TERMINAL_MAX_FILES"] ?? "5", 10) || 5));
  const maxPreviewLines = Math.max(1, Math.min(8, Number.parseInt(process.env["AGENT_EXTERNAL_TERMINAL_PREVIEW_LINES"] ?? "2", 10) || 2));

  const names = (await readdir(terminalDir).catch(() => []))
    .filter((n) => n.endsWith(".txt"))
    .slice(0, maxFiles);
  if (names.length === 0) return null;

  const entries: TerminalSnapshotSummary["entries"] = [];
  for (const name of names) {
    const filePath = path.join(terminalDir, name);
    const raw = await readFile(filePath, "utf8").catch(() => null);
    if (!raw) continue;
    const header = parseHeader(raw);
    entries.push({
      id: name.replace(/\.txt$/i, ""),
      pid: header.pid,
      cwd: header.cwd,
      lastCommand: header.lastCommand ? clampLine(redactSensitive(header.lastCommand), 140) : undefined,
      lastExitCode: header.lastExitCode,
      running: header.lastExitCode === undefined || Number.isNaN(header.lastExitCode),
      outputPreview: parseOutputPreview(raw, maxPreviewLines),
    });
  }
  if (entries.length === 0) return null;
  return { source: "external_terminal_snapshot", entries };
}

