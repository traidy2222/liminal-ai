#!/usr/bin/env node
/**
 * Smoke test: liminald starts, sidecar_ready fires, get_config succeeds.
 * Used to validate desktop loading is not blocked by a crashing sidecar.
 */
import { WebSocket } from "ws";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

const repoRoot = process.cwd();
const hsPath = join(homedir(), ".liminal", "sidecar.json");

function readHs() {
  if (!existsSync(hsPath)) return null;
  try {
    return JSON.parse(readFileSync(hsPath, "utf8"));
  } catch {
    return null;
  }
}

async function killStaleSidecar() {
  const h = readHs();
  if (h?.pid) {
    try {
      await new Promise((resolve) => {
        const p = spawn("taskkill", ["/PID", String(h.pid), "/T", "/F"], { shell: true });
        p.on("close", () => resolve(null));
        p.on("error", () => resolve(null));
      });
    } catch {
      /* already gone */
    }
  }
  if (existsSync(hsPath)) unlinkSync(hsPath);
  await new Promise((r) => setTimeout(r, 800));
}

function waitForHandshakeAfter(startedMs, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("no handshake")), ms);
    const iv = setInterval(() => {
      const h = readHs();
      if (h?.port && h?.token && (h.startedAt ?? 0) >= startedMs) {
        clearInterval(iv);
        clearTimeout(t);
        resolve(h);
      }
    }, 200);
  });
}

function waitForEvent(ws, pred, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
    const onMsg = (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.t !== "evt") return;
      if (pred(f)) {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve(f);
      }
    };
    ws.on("message", onMsg);
  });
}

const stderr = [];
await killStaleSidecar();
const spawnAt = Date.now();
const child = spawn("node", ["packages/sidecar/dist/index.js"], {
  cwd: repoRoot,
  env: { ...process.env, LIMINAL_REPO_ROOT: repoRoot },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (b) => process.stdout.write(`[liminald] ${b}`));
child.stderr.on("data", (b) => stderr.push(b.toString()));

let hs;
try {
  hs = await waitForHandshakeAfter(spawnAt - 2000, 120_000);
} catch (e) {
  console.error(stderr.join(""));
  throw e;
}
console.log("handshake port", hs.port);

const ws = new WebSocket(`ws://127.0.0.1:${hs.port}?token=${hs.token}`);
await new Promise((res, rej) => {
  ws.on("open", res);
  ws.on("error", rej);
});

const ready = await waitForEvent(ws, (f) => f.event === "sidecar_ready", 120_000, "sidecar_ready");
const d = ready.data ?? {};
console.log("sidecar_ready", {
  activeChatId: d.activeChatId,
  hasAppConfig: Boolean(d.appConfig),
  initError: d.initError,
  apiKeyConfigured: d.appConfig?.apiKeyConfigured,
  personaBootstrapPending: d.appConfig?.personaBootstrapPending,
});

ws.send(JSON.stringify({ t: "cmd", id: "cfg1", command: "get_config", data: {} }));
const ack = await waitForEvent(
  ws,
  (f) => f.event === "command_result" && f.data?.commandId === "cfg1",
  60_000,
  "get_config"
);
if (!ack.data?.ok) {
  console.error("get_config failed", ack.data);
  process.exit(1);
}
console.log("get_config ok", {
  apiKeyConfigured: ack.data.data?.apiKeyConfigured,
  personaBootstrapPending: ack.data.data?.personaBootstrapPending,
});

console.log("BOOT TEST PASSED");
child.kill();
ws.close();
process.exit(0);
