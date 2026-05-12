import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface ShellRuntime {
  kind: "powershell" | "pwsh" | "cmd" | "posix";
  executable: string;
  args: string[];
  displayName: string;
  commandChainHint: string;
}

export interface PlatformIdentity {
  label: string;
  shell: ShellRuntime;
}

export interface GitContext {
  branch: string;
  commitHash: string;
  commitMessage: string;
  commitAge: string;
  remoteUrl: string | null;
  isDirty: boolean;
  stashCount: number;
}

export interface PortContext {
  busy: number[];
  free: number[];
}

const DEFAULT_DEV_PORTS = [3000, 3001, 3002, 4000, 4200, 5000, 5001, 5173, 5174, 8000, 8080, 8888, 9000, 9229];

async function exec(cmd: string, args: string[], timeoutMs = 1000, cwd?: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFile(cmd, args, {
      timeout: timeoutMs,
      encoding: "utf8",
      windowsHide: true,
      ...(cwd ? { cwd } : {}),
    });
    return (stdout || stderr).trim() || null;
  } catch {
    return null;
  }
}

function getWindowsShellFromEnv(): ShellRuntime {
  const override = (process.env["AGENT_SHELL"] ?? "").trim().toLowerCase();
  if (override === "pwsh" || override === "powershell7") {
    return {
      kind: "pwsh",
      executable: "pwsh.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"],
      displayName: "PowerShell 7 (pwsh.exe)",
      commandChainHint: "Use ; or if ($?) { ... }. && works in PowerShell 7, but ; is universally safe.",
    };
  }
  if (override === "cmd") {
    return {
      kind: "cmd",
      executable: "cmd.exe",
      args: ["/d", "/s", "/c"],
      displayName: "cmd.exe",
      commandChainHint: "Use && for success-chain, || for failure-chain.",
    };
  }

  const psModulePath = (process.env["PSModulePath"] ?? "").toLowerCase();
  const isPwsh = psModulePath.includes("powershell\\7") || psModulePath.includes("powershell/7");
  if (isPwsh) {
    return {
      kind: "pwsh",
      executable: "pwsh.exe",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"],
      displayName: "PowerShell 7 (pwsh.exe)",
      commandChainHint: "Use ; or if ($?) { ... }. && works in PowerShell 7, but ; is universally safe.",
    };
  }

  return {
    kind: "powershell",
    executable: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"],
    displayName: "Windows PowerShell (powershell.exe)",
    commandChainHint: "Use ; or if ($?) { ... }. Do not use && in Windows PowerShell 5.1.",
  };
}

export function resolveShellRuntime(): ShellRuntime {
  if (process.platform === "win32") return getWindowsShellFromEnv();
  const shellPath = process.env["SHELL"]?.trim() || "/bin/sh";
  return {
    kind: "posix",
    executable: shellPath,
    args: ["-c"],
    displayName: path.basename(shellPath),
    commandChainHint: "Use && for success-chain and || for fallback; quote paths with spaces.",
  };
}

export function getShellNote(shell: ShellRuntime): string {
  if (process.platform === "win32") {
    if (shell.kind === "cmd") {
      return "dir/type/del are native commands. Paths use \\ by default.";
    }
    return "Get-ChildItem/Get-Content/Remove-Item are native cmdlets. Paths may use \\ or /.";
  }
  if (process.platform === "darwin") {
    return `${shell.displayName}. BSD userland defaults (sed/find/date differ from GNU).`;
  }
  return `${shell.displayName}. Standard POSIX shell semantics.`;
}

async function getMacVersion(): Promise<string | null> {
  const out = await exec("sw_vers", ["-productVersion"], 800);
  return out?.trim() || null;
}

async function getLinuxPrettyName(): Promise<string | null> {
  const raw = await readFile("/etc/os-release", "utf8").catch(() => null);
  if (!raw) return null;
  const line = raw.split("\n").find((l) => l.startsWith("PRETTY_NAME="));
  if (!line) return null;
  return line.replace("PRETTY_NAME=", "").replace(/^["']|["']$/g, "").trim() || null;
}

export async function getPlatformIdentity(): Promise<PlatformIdentity> {
  const arch = process.arch;
  const shell = resolveShellRuntime();
  if (process.platform === "win32") {
    const release = os.release();
    const build = parseInt(release.match(/^10\.0\.(\d+)/)?.[1] ?? "0", 10);
    const win = build >= 22000 ? "Windows 11" : build >= 10000 ? "Windows 10" : "Windows";
    return { label: `${win} build ${build} (${arch})`, shell };
  }
  if (process.platform === "darwin") {
    const version = (await getMacVersion()) ?? os.release();
    return { label: `macOS ${version} (${arch})`, shell };
  }
  const pretty = await getLinuxPrettyName();
  return { label: `${pretty ?? `Linux ${os.release()}`} (${arch})`, shell };
}

export async function gatherGitContext(workspaceRoot: string): Promise<GitContext | null> {
  const inside = await exec("git", ["rev-parse", "--is-inside-work-tree"], 900, workspaceRoot);
  if (!inside || inside !== "true") return null;

  const [branchRaw, headRaw, msgRaw, ageRaw, statusRaw, remoteRaw, stashRaw] = await Promise.all([
    exec("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], 900, workspaceRoot),
    exec("git", ["rev-parse", "--short", "HEAD"], 900, workspaceRoot),
    exec("git", ["log", "-1", "--format=%s"], 900, workspaceRoot),
    exec("git", ["log", "-1", "--format=%cr"], 900, workspaceRoot),
    exec("git", ["status", "--porcelain"], 900, workspaceRoot),
    exec("git", ["remote", "get-url", "origin"], 900, workspaceRoot),
    exec("git", ["stash", "list"], 900, workspaceRoot),
  ]);

  const detached = await exec("git", ["rev-parse", "--short", "HEAD"], 900, workspaceRoot);
  const branch = branchRaw ?? (detached ? `${detached} (detached)` : "unknown");
  const commitHash = headRaw ?? "unknown";
  const commitMessage = (msgRaw ?? "").trim().slice(0, 72);
  const commitAge = ageRaw ?? "unknown";
  const isDirty = Boolean(statusRaw && statusRaw.trim().length > 0);
  const stashCount = stashRaw ? stashRaw.split("\n").filter(Boolean).length : 0;

  return {
    branch,
    commitHash,
    commitMessage,
    commitAge,
    remoteUrl: remoteRaw ?? null,
    isDirty,
    stashCount,
  };
}

function parseWindowsNetstat(output: string): Set<number> {
  const listening = new Set<number>();
  for (const line of output.split("\n")) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    const local = cols[1] ?? "";
    const m = local.match(/:(\d+)$/);
    if (m) listening.add(parseInt(m[1]!, 10));
  }
  return listening;
}

function parseListenLines(output: string): Set<number> {
  const listening = new Set<number>();
  for (const line of output.split("\n")) {
    if (!/LISTEN/i.test(line)) continue;
    const m = line.match(/[:.](\d+)\b/);
    if (m) listening.add(parseInt(m[1]!, 10));
  }
  return listening;
}

export async function scanActiveDevPorts(devPorts: number[] = DEFAULT_DEV_PORTS): Promise<PortContext> {
  let listening = new Set<number>();
  if (process.platform === "win32") {
    const out = await exec("netstat", ["-ano", "-p", "TCP"], 2500);
    if (out) listening = parseWindowsNetstat(out);
  } else if (process.platform === "darwin") {
    const lsofOut = await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], 2500);
    const netstatOut = lsofOut ? null : await exec("netstat", ["-an", "-p", "tcp"], 2500);
    const src = lsofOut ?? netstatOut;
    if (src) listening = parseListenLines(src);
  } else {
    const out = await exec("ss", ["-tlnp"], 2000) ?? await exec("netstat", ["-tlnp"], 2000);
    if (out) listening = parseListenLines(out);
  }
  return {
    busy: devPorts.filter((p) => listening.has(p)),
    free: devPorts.filter((p) => !listening.has(p)),
  };
}

export function shellProtocolGuidance(): string {
  const shell = resolveShellRuntime();
  if (shell.kind === "cmd") {
    return [
      "## Shell runtime",
      "Detected shell: cmd.exe",
      "- Chain commands with `&&` or `||`.",
      "- Environment variables use `%VAR%`.",
      "- Prefer backslash paths on Windows.",
    ].join("\n");
  }
  if (shell.kind === "powershell" || shell.kind === "pwsh") {
    const psSpecific =
      shell.kind === "powershell"
        ? "- Windows PowerShell 5.1: use `;` or `if ($?) { ... }` (avoid `&&`)."
        : "- PowerShell 7+: `&&` works, but `;` remains universally safe.";
    return [
      "## Shell runtime",
      `Detected shell: ${shell.displayName}`,
      psSpecific,
      "- Use `$env:VAR` for environment variables.",
      "- `curl` can alias to `Invoke-WebRequest`; use `curl.exe` for curl flags.",
    ].join("\n");
  }
  return [
    "## Shell runtime",
    `Detected shell: ${shell.displayName}`,
    "- Use `&&` for success chaining and quote paths with spaces.",
    "- Environment variables use `$VAR`.",
  ].join("\n");
}

