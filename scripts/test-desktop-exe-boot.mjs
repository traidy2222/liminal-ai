#!/usr/bin/env node
/**
 * Launch liminal_desktop.exe and verify liminald reaches sidecar_ready.
 */
import { WebSocket } from "ws";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = join(
  repoRoot,
  "apps/liminal_desktop/build/windows/x64/runner/Release/liminal_desktop.exe"
);
const hsPath = join(homedir(), ".liminal", "sidecar.json");

function readHs() {
  if (!existsSync(hsPath)) return null;
  try {
    return JSON.parse(readFileSync(hsPath, "utf8"));
  } catch {
    return null;
  }
}

async function killStale() {
  const h = readHs();
  if (h?.pid) {
    await new Promise((resolve) => {
      const p = spawn("taskkill", ["/PID", String(h.pid), "/T", "/F"], { shell: true });
      p.on("close", () => resolve(null));
      p.on("error", () => resolve(null));
    });
  }
  if (existsSync(hsPath)) unlinkSync(hsPath);
  await new Promise((r) => setTimeout(r, 1000));
}

function waitForHandshakeAfter(startedMs, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("desktop exe never wrote sidecar.json")), ms);
    const iv = setInterval(() => {
      const h = readHs();
      if (h?.port && h?.token && (h.startedAt ?? 0) >= startedMs) {
        clearInterval(iv);
        clearTimeout(t);
        resolve(h);
      }
    }, 250);
  });
}

await killStale();
const spawnAt = Date.now();
console.log("Launching", exe);
const app = spawn(exe, [], {
  cwd: dirname(exe),
  detached: true,
  stdio: "ignore",
});
app.unref();

const hs = await waitForHandshakeAfter(spawnAt - 3000, 90_000);
console.log("sidecar handshake port", hs.port);

const ws = new WebSocket(`ws://127.0.0.1:${hs.port}?token=${hs.token}`);
await new Promise((res, rej) => {
  ws.on("open", res);
  ws.on("error", rej);
});

const ready = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("sidecar_ready timeout")), 120_000);
  ws.on("message", (raw) => {
    const f = JSON.parse(raw.toString());
    if (f.t === "evt" && f.event === "sidecar_ready") {
      clearTimeout(t);
      resolve(f.data);
    }
  });
});

console.log("sidecar_ready", {
  activeChatId: ready.activeChatId,
  hasAppConfig: Boolean(ready.appConfig),
  initError: ready.initError,
  apiKeyConfigured: ready.appConfig?.apiKeyConfigured,
});

if (ready.initError) {
  console.error("initError:", ready.initError);
  process.exit(1);
}

console.log("DESKTOP EXE BOOT TEST PASSED");
ws.close();
try {
  spawn("taskkill", ["/PID", String(app.pid), "/T", "/F"], { shell: true });
} catch {
  /* ignore */
}
process.exit(0);
