/**
 * Google workspace-mcp sidecar process manager.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { globalPath, ensureGlobalStorageRoot } from "@liminal/core";
import { effectiveHarnessEnvRaw } from "@liminal/core";

const SIDECAR_STATE_SEG = "sidecars/google_workspace.json";

export interface SidecarState {
  pid: number;
  port: number;
  startedAt: number;
  refCount: number;
}

let managedProcess: ChildProcess | null = null;
let localRefCount = 0;

function statePath(): string {
  return globalPath(SIDECAR_STATE_SEG);
}

function sidecarEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_GOOGLE_SIDECAR_ENABLE") !== "0";
}

export function sidecarPort(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_GOOGLE_SIDECAR_PORT") ?? "8010";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 8010;
}

function sidecarCmd(): string {
  return effectiveHarnessEnvRaw("AGENT_GOOGLE_SIDECAR_CMD")?.trim() || "uvx workspace-mcp";
}

function googleOAuthClientId(): string {
  return (
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ||
    process.env.AGENT_GOOGLE_OAUTH_CLIENT_ID?.trim() ||
    effectiveHarnessEnvRaw("AGENT_GOOGLE_OAUTH_CLIENT_ID")?.trim() ||
    ""
  );
}

function googleOAuthClientSecret(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || "";
}

export function googleSidecarMcpUrl(port = sidecarPort()): string {
  return `http://127.0.0.1:${port}/mcp`;
}

/** workspace-mcp listens on WORKSPACE_MCP_PORT (not --port CLI flags). */
export function buildSidecarEnv(port: number, accessToken?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.WORKSPACE_MCP_PORT = String(port);
  env.WORKSPACE_MCP_HOST = "127.0.0.1";
  env.WORKSPACE_MCP_TRANSPORT = "streamable-http";
  // Liminal owns OAuth — pass bearer tokens on each MCP request (mcp_attach).
  env.MCP_ENABLE_OAUTH21 = "true";
  env.EXTERNAL_OAUTH21_PROVIDER = "true";
  env.WORKSPACE_MCP_STATELESS_MODE = "true";
  env.OAUTHLIB_INSECURE_TRANSPORT = "1";
  const clientId = googleOAuthClientId();
  if (clientId) env.GOOGLE_OAUTH_CLIENT_ID = clientId;
  const secret = googleOAuthClientSecret();
  if (secret) env.GOOGLE_OAUTH_CLIENT_SECRET = secret;
  if (accessToken) env.GOOGLE_ACCESS_TOKEN = accessToken;
  return env;
}

export function buildSidecarArgs(
  cmd: string,
  opts?: { tools?: string[]; readOnly?: boolean }
): { bin: string; args: string[] } {
  const cmdParts = cmd.split(/\s+/).filter(Boolean);
  if (cmdParts.length === 0) {
    return { bin: "", args: [] };
  }
  const args = [...cmdParts.slice(1), "--transport", "streamable-http"];
  const tools = opts?.tools?.map((t) => t.trim()).filter(Boolean) ?? [];
  if (tools.length > 0) {
    args.push("--tools", ...tools);
  } else {
    args.push("--tool-tier", "complete");
  }
  if (opts?.readOnly) {
    args.push("--read-only");
  }
  return { bin: cmdParts[0]!, args };
}

async function readState(): Promise<SidecarState | null> {
  try {
    const raw = await readFile(statePath(), "utf8");
    return JSON.parse(raw) as SidecarState;
  } catch {
    return null;
  }
}

async function ensureSidecarStateDir(): Promise<void> {
  await ensureGlobalStorageRoot();
  await mkdir(path.dirname(statePath()), { recursive: true });
}

async function writeState(state: SidecarState): Promise<void> {
  await ensureSidecarStateDir();
  await writeFile(statePath(), JSON.stringify(state, null, 2), "utf8");
}

async function clearState(): Promise<void> {
  try {
    await unlink(statePath());
  } catch {
    /* ignore */
  }
}

function sidecarHttpReadyStatus(status: number): boolean {
  // 401 = server up but requires bearer token (external OAuth provider mode).
  return status === 200 || status === 406 || status === 401;
}

async function waitForSidecarReady(
  port: number,
  timeoutMs = 30_000,
  accessToken?: string
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/mcp`;
  while (Date.now() < deadline) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "liminal-sidecar-probe", version: "0.1.0" },
          },
        }),
        signal: AbortSignal.timeout(3000),
      });
      if (sidecarHttpReadyStatus(res.status)) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export interface GoogleSidecarStartOptions {
  /** workspace-mcp `--tools` service ids (docs, sheets, …). */
  tools?: string[];
  readOnly?: boolean;
}

export async function ensureGoogleSidecarRunning(
  accessToken?: string,
  opts?: GoogleSidecarStartOptions
): Promise<{ ok: boolean; url: string; error?: string }> {
  if (!sidecarEnabled()) {
    return { ok: false, url: googleSidecarMcpUrl(), error: "AGENT_GOOGLE_SIDECAR_ENABLE=0" };
  }

  const port = sidecarPort();
  const url = googleSidecarMcpUrl(port);
  const existing = await readState();
  if (existing && existing.port === port) {
    localRefCount++;
    existing.refCount = localRefCount;
    await writeState(existing);
    const ready = await waitForSidecarReady(port, 5000, accessToken);
    if (ready) return { ok: true, url };
  }

  const { bin, args } = buildSidecarArgs(sidecarCmd(), opts);
  if (!bin) {
    return { ok: false, url, error: "AGENT_GOOGLE_SIDECAR_CMD is empty" };
  }
  if (!googleOAuthClientId()) {
    return {
      ok: false,
      url,
      error:
        "GOOGLE_OAUTH_CLIENT_ID is required for workspace-mcp sidecar (set in .env or AGENT_GOOGLE_OAUTH_CLIENT_ID).",
    };
  }

  const env = buildSidecarEnv(port, accessToken);
  let stderr = "";

  try {
    managedProcess = spawn(bin, args, {
      env,
      detached: false,
      stdio: ["ignore", "ignore", "pipe"],
      shell: process.platform === "win32",
    });
  } catch (e) {
    return {
      ok: false,
      url,
      error: `failed to spawn sidecar: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  managedProcess.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += String(chunk);
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  const earlyExit = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 2500);
    managedProcess?.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
  if (earlyExit !== null) {
    const detail = stderr.trim().split(/\r?\n/).slice(-4).join(" ").trim();
    await stopGoogleSidecar(true);
    return {
      ok: false,
      url,
      error:
        `workspace-mcp exited (code ${earlyExit})` +
        (detail ? `: ${detail}` : ". Install uv (https://docs.astral.sh/uv/) and run `uvx workspace-mcp --help`."),
    };
  }

  localRefCount = 1;
  const pid = managedProcess.pid ?? 0;
  await writeState({ pid, port, startedAt: Date.now(), refCount: localRefCount });

  managedProcess.on("exit", () => {
    managedProcess = null;
    void clearState();
  });

  const ready = await waitForSidecarReady(port, 30_000, accessToken);
  if (!ready) {
    const detail = stderr.trim().split(/\r?\n/).slice(-4).join(" ").trim();
    await stopGoogleSidecar(true);
    return {
      ok: false,
      url,
      error:
        `sidecar did not become ready on port ${port} within 30s` +
        (detail ? ` — ${detail}` : " (is uv/uvx installed? is the port free?)"),
    };
  }
  return { ok: true, url };
}

export async function releaseGoogleSidecar(): Promise<void> {
  localRefCount = Math.max(0, localRefCount - 1);
  const state = await readState();
  if (state) {
    state.refCount = localRefCount;
    await writeState(state);
  }
  if (localRefCount <= 0) {
    await stopGoogleSidecar(false);
  }
}

export async function stopGoogleSidecar(force = false): Promise<void> {
  localRefCount = 0;
  if (managedProcess && !managedProcess.killed) {
    managedProcess.kill(force ? "SIGKILL" : "SIGTERM");
    managedProcess = null;
  } else if (existsSync(statePath())) {
    const state = await readState();
    if (state?.pid) {
      try {
        process.kill(state.pid, force ? "SIGKILL" : "SIGTERM");
      } catch {
        /* already dead */
      }
    }
  }
  await clearState();
}

export async function getGoogleSidecarStatus(): Promise<{
  enabled: boolean;
  running: boolean;
  port: number;
  pid?: number;
  url: string;
}> {
  const port = sidecarPort();
  const state = await readState();
  const ready = await waitForSidecarReady(port, 2000);
  return {
    enabled: sidecarEnabled(),
    running: ready,
    port,
    pid: state?.pid,
    url: googleSidecarMcpUrl(port),
  };
}
