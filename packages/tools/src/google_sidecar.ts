/**
 * Google workspace-mcp sidecar process manager.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { globalPath } from "@liminal/core";
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

function sidecarPort(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_GOOGLE_SIDECAR_PORT") ?? "8010";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 8010;
}

function sidecarCmd(): string {
  return effectiveHarnessEnvRaw("AGENT_GOOGLE_SIDECAR_CMD")?.trim() || "uvx workspace-mcp";
}

export function googleSidecarMcpUrl(): string {
  return `http://127.0.0.1:${sidecarPort()}/mcp`;
}

async function readState(): Promise<SidecarState | null> {
  try {
    const raw = await readFile(statePath(), "utf8");
    return JSON.parse(raw) as SidecarState;
  } catch {
    return null;
  }
}

async function writeState(state: SidecarState): Promise<void> {
  await writeFile(statePath(), JSON.stringify(state, null, 2), "utf8");
}

async function clearState(): Promise<void> {
  try {
    await unlink(statePath());
  } catch {
    /* ignore */
  }
}

async function waitForSidecarReady(port: number, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/mcp`;
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
      if (res.ok || res.status === 406) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function ensureGoogleSidecarRunning(accessToken?: string): Promise<{ ok: boolean; url: string; error?: string }> {
  if (!sidecarEnabled()) {
    return { ok: false, url: googleSidecarMcpUrl(), error: "AGENT_GOOGLE_SIDECAR_ENABLE=0" };
  }

  const port = sidecarPort();
  const url = `http://127.0.0.1:${port}/mcp`;
  const existing = await readState();
  if (existing && existing.port === port) {
    localRefCount++;
    existing.refCount = localRefCount;
    await writeState(existing);
    const ready = await waitForSidecarReady(port, 5000);
    if (ready) return { ok: true, url };
  }

  const cmdParts = sidecarCmd().split(/\s+/).filter(Boolean);
  if (cmdParts.length === 0) {
    return { ok: false, url, error: "AGENT_GOOGLE_SIDECAR_CMD is empty" };
  }

  const env = { ...process.env };
  if (accessToken) env.GOOGLE_ACCESS_TOKEN = accessToken;

  const args = [
    ...cmdParts.slice(1),
    "--transport",
    "streamable-http",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ];

  try {
    managedProcess = spawn(cmdParts[0]!, args, {
      env,
      detached: false,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
  } catch (e) {
    return {
      ok: false,
      url,
      error: `failed to spawn sidecar: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  localRefCount = 1;
  const pid = managedProcess.pid ?? 0;
  await writeState({ pid, port, startedAt: Date.now(), refCount: localRefCount });

  managedProcess.on("exit", () => {
    managedProcess = null;
    void clearState();
  });

  const ready = await waitForSidecarReady(port);
  if (!ready) {
    await stopGoogleSidecar(true);
    return { ok: false, url, error: "sidecar did not become ready within 30s (is uv/uvx installed?)" };
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
  const ready = state ? await waitForSidecarReady(port, 2000) : false;
  return {
    enabled: sidecarEnabled(),
    running: ready,
    port,
    pid: state?.pid,
    url: googleSidecarMcpUrl(),
  };
}
