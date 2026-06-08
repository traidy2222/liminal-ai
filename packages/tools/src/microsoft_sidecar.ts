/**
 * @softeria/ms-365-mcp-server sidecar process manager.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { globalPath, ensureGlobalStorageRoot, effectiveHarnessEnvRaw } from "@liminal/core";

const SIDECAR_STATE_SEG = "sidecars/microsoft_365.json";

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
  return effectiveHarnessEnvRaw("AGENT_MICROSOFT_SIDECAR_ENABLE") !== "0";
}

export function sidecarPort(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_MICROSOFT_SIDECAR_PORT") ?? "8011";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 8011;
}

function sidecarCmd(): string {
  return (
    effectiveHarnessEnvRaw("AGENT_MICROSOFT_SIDECAR_CMD")?.trim() ||
    "npx @softeria/ms-365-mcp-server --http"
  );
}

function microsoftOAuthClientId(): string {
  return (
    process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim() ||
    process.env.AGENT_MICROSOFT_OAUTH_CLIENT_ID?.trim() ||
    ""
  );
}

function microsoftOAuthClientSecret(): string {
  return (
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.AGENT_MICROSOFT_OAUTH_CLIENT_SECRET?.trim() ||
    ""
  );
}

export function microsoftSidecarMcpUrl(port = sidecarPort()): string {
  return `http://127.0.0.1:${port}/mcp`;
}

export function buildMicrosoftSidecarEnv(port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const clientId = microsoftOAuthClientId();
  if (clientId) env.MS365_MCP_CLIENT_ID = clientId;
  const secret = microsoftOAuthClientSecret();
  if (secret) env.MS365_MCP_CLIENT_SECRET = secret;
  const tenant =
    process.env.MICROSOFT_TENANT_ID?.trim() ||
    process.env.AGENT_MICROSOFT_TENANT_ID?.trim() ||
    "common";
  env.MS365_MCP_TENANT_ID = tenant;
  env.OAUTHLIB_INSECURE_TRANSPORT = "1";
  return env;
}

export function buildMicrosoftSidecarArgs(
  cmd: string,
  port: number,
  opts?: { readOnly?: boolean; orgMode?: boolean }
): { bin: string; args: string[] } {
  const cmdParts = cmd.split(/\s+/).filter(Boolean);
  if (cmdParts.length === 0) {
    return { bin: "", args: [] };
  }
  const args = [...cmdParts.slice(1)];
  const hasHttp = args.some((a) => a === "--http" || a.startsWith("--http="));
  if (!hasHttp) {
    args.push("--http", String(port));
  } else {
    const idx = args.findIndex((a) => a === "--http");
    if (idx >= 0 && idx + 1 < args.length && !args[idx + 1]!.startsWith("-")) {
      args[idx + 1] = String(port);
    } else if (idx >= 0) {
      args.splice(idx + 1, 0, String(port));
    }
  }
  if (opts?.readOnly) args.push("--read-only");
  if (opts?.orgMode ?? effectiveHarnessEnvRaw("AGENT_MICROSOFT_SIDECAR_ORG_MODE") === "1") {
    args.push("--org-mode");
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

export interface MicrosoftSidecarStartOptions {
  readOnly?: boolean;
  orgMode?: boolean;
}

export async function ensureMicrosoftSidecarRunning(
  accessToken?: string,
  opts?: MicrosoftSidecarStartOptions
): Promise<{ ok: boolean; url: string; error?: string }> {
  if (!sidecarEnabled()) {
    return { ok: false, url: microsoftSidecarMcpUrl(), error: "AGENT_MICROSOFT_SIDECAR_ENABLE=0" };
  }

  const port = sidecarPort();
  const url = microsoftSidecarMcpUrl(port);
  const existing = await readState();
  if (existing && existing.port === port) {
    localRefCount++;
    existing.refCount = localRefCount;
    await writeState(existing);
    const ready = await waitForSidecarReady(port, 5000, accessToken);
    if (ready) return { ok: true, url };
  }

  const { bin, args } = buildMicrosoftSidecarArgs(sidecarCmd(), port, opts);
  if (!bin) {
    return { ok: false, url, error: "AGENT_MICROSOFT_SIDECAR_CMD is empty" };
  }
  if (!microsoftOAuthClientId()) {
    return {
      ok: false,
      url,
      error: "MICROSOFT_OAUTH_CLIENT_ID is required for ms-365-mcp-server sidecar.",
    };
  }

  const env = buildMicrosoftSidecarEnv(port);
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
    await stopMicrosoftSidecar(true);
    return {
      ok: false,
      url,
      error:
        `ms-365-mcp-server exited (code ${earlyExit})` +
        (detail ? `: ${detail}` : ". Ensure Node.js and npx are available."),
    };
  }

  localRefCount = 1;
  const pid = managedProcess.pid ?? 0;
  await writeState({ pid, port, startedAt: Date.now(), refCount: localRefCount });

  managedProcess.on("exit", () => {
    managedProcess = null;
    void clearState();
  });

  const ready = await waitForSidecarReady(port, 45_000, accessToken);
  if (!ready) {
    const detail = stderr.trim().split(/\r?\n/).slice(-4).join(" ").trim();
    await stopMicrosoftSidecar(true);
    return {
      ok: false,
      url,
      error:
        `sidecar did not become ready on port ${port} within 45s` +
        (detail ? ` — ${detail}` : " (is the port free?)"),
    };
  }
  return { ok: true, url };
}

export async function releaseMicrosoftSidecar(): Promise<void> {
  localRefCount = Math.max(0, localRefCount - 1);
  const state = await readState();
  if (state) {
    state.refCount = localRefCount;
    await writeState(state);
  }
  if (localRefCount <= 0) {
    await stopMicrosoftSidecar(false);
  }
}

export async function stopMicrosoftSidecar(force = false): Promise<void> {
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

export async function getMicrosoftSidecarStatus(): Promise<{
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
    url: microsoftSidecarMcpUrl(port),
  };
}
