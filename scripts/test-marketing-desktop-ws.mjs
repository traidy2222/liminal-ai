#!/usr/bin/env node
/**
 * Smoke test: marketing desktop WS stays connected through chat setup.
 * Does not send harness prompts (no API cost).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DESKTOP_EXE,
  killExistingDesktop,
  killStaleSidecar,
  marketingDesktopChildEnv,
  waitForFreshHandshake,
} from "./lib/marketing-sidecar.mjs";
import { SidecarWsClient } from "./lib/sidecar-ws-client.mjs";
import { resetWindowTitleCache, waitForDesktopWindow } from "./lib/marketing-window-capture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const exe = process.env.LIMINAL_DESKTOP_EXE ?? DEFAULT_DESKTOP_EXE;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const launchStartedAt = Date.now() - 3000;
await killStaleSidecar();
await killExistingDesktop();

console.log("[test] Launching desktop…");
const child = spawn(exe, [], {
  detached: true,
  stdio: "ignore",
  cwd: path.dirname(exe),
  windowsHide: true,
  env: marketingDesktopChildEnv(),
});
child.unref();

const handshake = await waitForFreshHandshake(launchStartedAt, 120_000);
console.log("[test] Handshake", handshake.port, "pid", handshake.pid);

const client = new SidecarWsClient(handshake.port, handshake.token);
await client.connect();

resetWindowTitleCache();
const title = await waitForDesktopWindow(90_000);
console.log("[test] Window", title);

await client.purgeStaleMarketingChats();
const chatId = (
  await client.sendCommand("create_chat", {
    title: "marketing-ws-smoke",
    workspaceRoot: REPO_ROOT,
  })
).data?.chatId;
if (!chatId) throw new Error("create_chat failed");

await client.prepareMarketingChat(chatId);
await client.sendCommand("get_config", {});
await sleep(2000);
await client.sendCommand("delete_chat", { chatId });

client.close();
spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: true }).unref();

console.log("[test] MARKETING DESKTOP WS SMOKE PASSED");
