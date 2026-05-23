import { spawn } from "node:child_process";
import net from "node:net";
import { log } from "./log.mjs";

/**
 * @param {number} port
 * @param {string} [host]
 */
export function openBrowserUrl(port, host = "127.0.0.1") {
  const url = `http://${host}:${port}/`;
  log("info", `Opening ${url}`);

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

/**
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
export async function waitForHttpReady(port, host = "127.0.0.1") {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${host}:${port}/api/status`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        return true;
      }
    } catch {
      // keep polling
    }
    await sleep(500);
  }
  return false;
}

/**
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
export async function waitForTcpReady(port, host = "127.0.0.1") {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ok = await tcpConnect(port, host);
    if (ok) {
      return true;
    }
    await sleep(400);
  }
  return false;
}

/**
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
function tcpConnect(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until the web server responds, then open the default browser once.
 *
 * @param {number} port
 */
export function scheduleBrowserOpen(port) {
  void (async () => {
    const ready = await waitForHttpReady(port);
    if (ready) {
      openBrowserUrl(port);
      return;
    }
    const tcp = await waitForTcpReady(port);
    if (tcp) {
      openBrowserUrl(port);
      return;
    }
    log("warn", `Server did not become ready on port ${port} within 30s; open http://127.0.0.1:${port}/ manually.`);
  })();
}
