/**
 * idalib-mcp / ida-pro-mcp sidecar process manager (local reverse-engineering MCP).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { globalPath, ensureGlobalStorageRoot, effectiveHarnessEnvRaw } from "@liminal/core";
import { withIdaMcpExtensions } from "./ida_probe.js";

const SIDECAR_STATE_SEG = "sidecars/ida.json";

export interface IdaSidecarState {
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

export function idaSidecarEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_IDA_SIDECAR_ENABLE") !== "0";
}

export function idaSidecarPort(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_IDA_SIDECAR_PORT") ?? "8745";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 8745;
}

function sidecarCmd(): string {
  return effectiveHarnessEnvRaw("AGENT_IDA_SIDECAR_CMD")?.trim() || "uv run idalib-mcp";
}

/** Streamable HTTP MCP endpoint for idalib-mcp (override with AGENT_IDA_MCP_URL). */
export function idaSidecarMcpUrl(port = idaSidecarPort()): string {
  const override = effectiveHarnessEnvRaw("AGENT_IDA_MCP_URL")?.trim();
  if (override) return withIdaMcpExtensions(override);
  return withIdaMcpExtensions(`http://127.0.0.1:${port}/mcp`);
}

export function buildIdaSidecarArgs(cmd: string, port: number): { bin: string; args: string[] } {
  const cmdParts = cmd.split(/\s+/).filter(Boolean);
  if (cmdParts.length === 0) {
    return { bin: "", args: [] };
  }
  const args = [...cmdParts.slice(1)];
  const hasHost = args.some((a) => a === "--host" || a.startsWith("--host="));
  const hasPort = args.some((a) => a === "--port" || a.startsWith("--port="));
  if (!hasHost) args.push("--host", "127.0.0.1");
  if (!hasPort) args.push("--port", String(port));
  return { bin: cmdParts[0]!, args };
}

async function readState(): Promise<IdaSidecarState | null> {
  try {
    const raw = await readFile(statePath(), "utf8");
    return JSON.parse(raw) as IdaSidecarState;
  } catch {
    return null;
  }
}

async function ensureSidecarStateDir(): Promise<void> {
  await ensureGlobalStorageRoot();
  await mkdir(path.dirname(statePath()), { recursive: true });
}

async function writeState(state: IdaSidecarState): Promise<void> {
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

async function waitForSidecarReady(port: number, timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = idaSidecarMcpUrl(port);
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
        signal: AbortSignal.timeout(5000),
      });
      if (sidecarHttpReadyStatus(res.status)) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function ensureIdaSidecarRunning(): Promise<{ ok: boolean; url: string; error?: string }> {
  if (!idaSidecarEnabled()) {
    const url = idaSidecarMcpUrl();
    return { ok: false, url, error: "AGENT_IDA_SIDECAR_ENABLE=0" };
  }

  const port = idaSidecarPort();
  const url = idaSidecarMcpUrl(port);
  const existing = await readState();
  if (existing && existing.port === port) {
    localRefCount++;
    existing.refCount = localRefCount;
    await writeState(existing);
    const ready = await waitForSidecarReady(port, 10_000);
    if (ready) return { ok: true, url };
  }

  const { bin, args } = buildIdaSidecarArgs(sidecarCmd(), port);
  if (!bin) {
    return { ok: false, url, error: "AGENT_IDA_SIDECAR_CMD is empty" };
  }

  let stderr = "";
  try {
    managedProcess = spawn(bin, args, {
      env: { ...process.env },
      detached: false,
      stdio: ["ignore", "ignore", "pipe"],
      shell: process.platform === "win32",
    });
  } catch (e) {
    return {
      ok: false,
      url,
      error: `failed to spawn IDA MCP sidecar: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  managedProcess.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += String(chunk);
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  const earlyExit = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    managedProcess?.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
  if (earlyExit !== null) {
    const detail = stderr.trim().split(/\r?\n/).slice(-4).join(" ").trim();
    await stopIdaSidecar(true);
    return {
      ok: false,
      url,
      error:
        `idalib-mcp exited (code ${earlyExit})` +
        (detail ? `: ${detail}` : "") +
        ". Install ida-pro-mcp (`pip install` / `uv`) and activate idalib, or set AGENT_IDA_MCP_URL to an existing IDA plugin/SSE server.",
    };
  }

  const ready = await waitForSidecarReady(port);
  if (!ready) {
    await stopIdaSidecar(true);
    return {
      ok: false,
      url,
      error:
        `IDA MCP not ready on ${url} after 90s. ` +
        "Ensure IDA Pro + idalib are installed, or run ida-pro-mcp in IDA (Edit → Plugins → MCP) and set AGENT_IDA_MCP_URL.",
    };
  }

  localRefCount = 1;
  await writeState({
    pid: managedProcess.pid ?? 0,
    port,
    startedAt: Date.now(),
    refCount: localRefCount,
  });
  return { ok: true, url };
}

export async function stopIdaSidecar(force = false): Promise<void> {
  if (!force) {
    localRefCount = Math.max(0, localRefCount - 1);
    const state = await readState();
    if (state && localRefCount > 0) {
      state.refCount = localRefCount;
      await writeState(state);
      return;
    }
  }
  localRefCount = 0;
  if (managedProcess && !managedProcess.killed) {
    try {
      managedProcess.kill();
    } catch {
      /* ignore */
    }
  }
  managedProcess = null;
  await clearState();
}

export async function getIdaSidecarStatus(): Promise<{
  enabled: boolean;
  running: boolean;
  port: number;
  pid?: number;
  url: string;
}> {
  const port = idaSidecarPort();
  const state = await readState();
  const ready = await waitForSidecarReady(port, 2500);
  return {
    enabled: idaSidecarEnabled(),
    running: ready,
    port,
    pid: state?.pid,
    url: idaSidecarMcpUrl(port),
  };
}
