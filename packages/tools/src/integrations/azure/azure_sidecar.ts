/**
 * @azure/mcp sidecar process manager.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  globalPath,
  ensureGlobalStorageRoot,
  effectiveHarnessEnvRaw,
  azureSidecarNamespaces,
  type AzureServicePreset,
} from "@liminal/core";

const SIDECAR_STATE_SEG = "sidecars/azure.json";

export interface AzureSidecarState {
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
  return effectiveHarnessEnvRaw("AGENT_AZURE_SIDECAR_ENABLE") !== "0";
}

export function azureSidecarPort(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_AZURE_SIDECAR_PORT") ?? "8012";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 8012;
}

function sidecarCmd(): string {
  return (
    effectiveHarnessEnvRaw("AGENT_AZURE_SIDECAR_CMD")?.trim() ||
    "npx -y @azure/mcp@latest server start"
  );
}

/** @azure/mcp HTTP transport listens at the root path (not /mcp). */
export function azureSidecarMcpUrl(port = azureSidecarPort()): string {
  return `http://127.0.0.1:${port}/`;
}

export function buildAzureSidecarEnv(port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.ASPNETCORE_URLS = `http://127.0.0.1:${port}`;
  const tenant =
    process.env.AZURE_TENANT_ID?.trim() ||
    process.env.MICROSOFT_TENANT_ID?.trim() ||
    process.env.AGENT_MICROSOFT_TENANT_ID?.trim();
  if (tenant) env.AZURE_TENANT_ID = tenant;
  const clientId =
    process.env.AZURE_CLIENT_ID?.trim() ||
    process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim() ||
    process.env.AGENT_MICROSOFT_OAUTH_CLIENT_ID?.trim();
  if (clientId) env.AZURE_CLIENT_ID = clientId;
  const secret =
    process.env.AZURE_CLIENT_SECRET?.trim() ||
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.AGENT_MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  if (secret) env.AZURE_CLIENT_SECRET = secret;
  return env;
}

export function buildAzureSidecarArgs(
  cmd: string,
  port: number,
  presets?: AzureServicePreset[]
): { bin: string; args: string[] } {
  const cmdParts = cmd.split(/\s+/).filter(Boolean);
  if (cmdParts.length === 0) {
    return { bin: "", args: [] };
  }
  const args = [...cmdParts.slice(1)];
  const hasTransport = args.some((a) => a === "--transport" || a.startsWith("--transport="));
  if (!hasTransport) {
    args.push("--transport", "http");
  }
  const hasDisableAuth = args.some((a) => a === "--dangerously-disable-http-incoming-auth");
  if (!hasDisableAuth) {
    args.push("--dangerously-disable-http-incoming-auth");
  }
  const namespaces = presets ? azureSidecarNamespaces(presets) : [];
  const hasMode = args.some((a) => a === "--mode" || a.startsWith("--mode="));
  if (!hasMode) {
    if (namespaces.length > 0) {
      args.push("--mode", "namespace");
      for (const ns of namespaces) {
        args.push("--namespace", ns);
      }
    } else {
      args.push("--mode", "all");
    }
  }
  void port;
  return { bin: cmdParts[0]!, args };
}

async function readState(): Promise<AzureSidecarState | null> {
  try {
    const raw = await readFile(statePath(), "utf8");
    return JSON.parse(raw) as AzureSidecarState;
  } catch {
    return null;
  }
}

async function ensureSidecarStateDir(): Promise<void> {
  await ensureGlobalStorageRoot();
  await mkdir(path.dirname(statePath()), { recursive: true });
}

async function writeState(state: AzureSidecarState): Promise<void> {
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

async function waitForSidecarReady(port: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = azureSidecarMcpUrl(port);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
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

export interface AzureSidecarStartOptions {
  presets?: AzureServicePreset[];
}

export async function ensureAzureSidecarRunning(
  opts?: AzureSidecarStartOptions
): Promise<{ ok: boolean; url: string; error?: string }> {
  if (!sidecarEnabled()) {
    return { ok: false, url: azureSidecarMcpUrl(), error: "AGENT_AZURE_SIDECAR_ENABLE=0" };
  }

  const port = azureSidecarPort();
  const url = azureSidecarMcpUrl(port);
  const existing = await readState();
  if (existing && existing.port === port) {
    localRefCount++;
    existing.refCount = localRefCount;
    await writeState(existing);
    const ready = await waitForSidecarReady(port, 5000);
    if (ready) return { ok: true, url };
  }

  const { bin, args } = buildAzureSidecarArgs(sidecarCmd(), port, opts?.presets);
  if (!bin) {
    return { ok: false, url, error: "AGENT_AZURE_SIDECAR_CMD is empty" };
  }

  const env = buildAzureSidecarEnv(port);
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
    await stopAzureSidecar(true);
    return {
      ok: false,
      url,
      error:
        `@azure/mcp exited (code ${earlyExit})` +
        (detail ? `: ${detail}` : ". Ensure Node.js, npx, and .NET 8+ are available."),
    };
  }

  localRefCount = 1;
  const pid = managedProcess.pid ?? 0;
  await writeState({ pid, port, startedAt: Date.now(), refCount: localRefCount });

  managedProcess.on("exit", () => {
    managedProcess = null;
    void clearState();
  });

  const ready = await waitForSidecarReady(port, 90_000);
  if (!ready) {
    const detail = stderr.trim().split(/\r?\n/).slice(-4).join(" ").trim();
    await stopAzureSidecar(true);
    return {
      ok: false,
      url,
      error:
        `Azure MCP sidecar did not become ready on port ${port} within 90s` +
        (detail ? ` — ${detail}` : " (is the port free?)"),
    };
  }
  return { ok: true, url };
}

export async function releaseAzureSidecar(): Promise<void> {
  localRefCount = Math.max(0, localRefCount - 1);
  const state = await readState();
  if (state) {
    state.refCount = localRefCount;
    await writeState(state);
  }
  if (localRefCount <= 0) {
    await stopAzureSidecar(false);
  }
}

export async function stopAzureSidecar(force = false): Promise<void> {
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

export async function getAzureSidecarStatus(): Promise<{
  enabled: boolean;
  running: boolean;
  port: number;
  pid?: number;
  url: string;
}> {
  const port = azureSidecarPort();
  const state = await readState();
  const ready = await waitForSidecarReady(port, 2000);
  return {
    enabled: sidecarEnabled(),
    running: ready,
    port,
    pid: state?.pid,
    url: azureSidecarMcpUrl(port),
  };
}
