import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { openBrowserSession, getBrowserSession, closeBrowserSession, controlBrowserWorkspace,
  browserWorkspaceState, shutdownBrowserWorkspace, registerBrowserTurnCleanup,
  checkBrowserSessionOwner, actOnBrowserSession } from "./browser_runtime.js";
import { readBrowserWorkspace } from "./browser_profile.js";
import { registerDesktopBrowser, pollDesktopBrowser, completeDesktopBrowserCommand,
  requestDesktopBrowserTab, disconnectDesktopBrowser } from "./browser_desktop.js";

test("persistent shared browser: user/agent state, turn lifetime, isolated tabs, restart and takeover", { skip: process.env.AGENT_BROWSER_INTEGRATION !== "1" }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "liminal-browser-workspace-"));
  const prior = process.env.LIMINAL_BROWSER_DATA_DIR;
  process.env.LIMINAL_BROWSER_DATA_DIR = root;
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end('<title>Shared browser fixture</title><input id="entry"><button onclick="localStorage.setItem(\'entry\',document.querySelector(\'#entry\').value)">Save</button>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  const open = (ownerTaskId: string) => openBrowserSession({ ownerTaskId, href: url, waitUntil: "load",
    navTimeoutMs: 5000, postWaitMs: 0, includeConsole: false, includeSnapshot: false });
  try {
    const a = await open("agent-a"); assert.ok(a.ok, a.ok ? "" : a.error);
    const b = await open("agent-b"); assert.ok(b.ok, b.ok ? "" : b.error);
    const pageA = getBrowserSession(a.sessionId)!.page;
    const pageB = getBrowserSession(b.sessionId)!.page;
    assert.notEqual(pageA, pageB);
    assert.equal(pageA.context(), pageB.context(), "one signed-in profile, distinct live tabs");
    const failed = await openBrowserSession({ ownerTaskId: "agent-fail", href: "http://127.0.0.1:9/", waitUntil: "load", navTimeoutMs: 1000, postWaitMs: 0, includeConsole: false, includeSnapshot: false });
    assert.equal(failed.ok, false); assert.equal(pageB.isClosed(), false);
    assert.equal(browserWorkspaceState().tabs.length, 2, "failed opens must not leave ghost tabs");
    assert.deepEqual(browserWorkspaceState("agent-a").tabs.map(t => t.sessionId), [a.sessionId]);
    assert.deepEqual(browserWorkspaceState("agent-b").tabs.map(t => t.sessionId), [b.sessionId]);
    const legacy = await open("user"); assert.ok(legacy.ok);
    assert.match(checkBrowserSessionOwner(legacy.sessionId, "agent-b") ?? "", /another agent/);
    await controlBrowserWorkspace("restore", undefined, undefined, "agent-a");
    assert.ok(browserWorkspaceState("agent-a").tabs.some(t => t.sessionId === legacy.sessionId), "unassigned legacy tabs migrate through an explicit chat workspace");
    await closeBrowserSession({ sessionId: legacy.sessionId });
    for (const action of ["focus", "close", "navigate", "pause"]) {
      const denied = await controlBrowserWorkspace(action, b.sessionId, url, "agent-a");
      assert.equal(denied.ok, false, `${action} cannot affect another chat`);
    }
    await pageA.locator("#entry").fill("user-edited");
    await pageA.getByRole("button").click();
    assert.equal(await pageB.evaluate(() => localStorage.getItem("entry")), "user-edited");
    const result = await actOnBrowserSession({ sessionId: a.sessionId, actions: [{ op: "fill", selector: "#entry", value: "agent-edited" }],
      postActionWaitMs: 0, refreshSnapshot: false, includeConsole: false });
    assert.ok(result.ok);
    assert.equal(await pageA.locator("#entry").inputValue(), "agent-edited", "agent changes are on the visible live page");
    await pageA.evaluate(async () => {
      document.cookie = "liminal_fixture=persisted; max-age=3600; path=/";
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("fixture", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("values");
        req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("values", "readwrite"); tx.objectStore("values").put("persisted", "key");
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      }); db.close();
    });
    assert.match(checkBrowserSessionOwner(a.sessionId, "agent-b")!, /another agent/);
    let previousCleanup = false;
    const harness = { taskId: "agent-a", onTurnEndCleanup: (_id: string) => { previousCleanup = true; } };
    registerBrowserTurnCleanup(harness); harness.onTurnEndCleanup("agent-a");
    assert.ok(previousCleanup); assert.ok(getBrowserSession(a.sessionId), "turn end must preserve the tab");
    await controlBrowserWorkspace("pause", a.sessionId);
    const blocked = await actOnBrowserSession({ sessionId: a.sessionId, actions: [{ op: "fill", selector: "#entry", value: "blocked" }],
      postActionWaitMs: 0, refreshSnapshot: false, includeConsole: false });
    assert.equal(blocked.ok, false); assert.equal(await pageA.locator("#entry").inputValue(), "agent-edited");
    await controlBrowserWorkspace("resume", a.sessionId);
    await closeBrowserSession({ sessionId: a.sessionId });
    assert.equal(pageB.isClosed(), false, "closing one tab must not close its sibling or profile");
    const b2 = await open("agent-b"); assert.ok(b2.ok);
    await controlBrowserWorkspace("focus", b.sessionId, undefined, "agent-b");
    assert.equal(browserWorkspaceState("agent-b").selectedTabId, b.sessionId);
    await shutdownBrowserWorkspace();
    assert.equal(readBrowserWorkspace().tabs.length, 2);
    assert.equal(readBrowserWorkspace().tabs[0]!.sessionId, b.sessionId);
    await controlBrowserWorkspace("restore");
    assert.equal(getBrowserSession(b.sessionId), undefined, "restore preserves metadata without reopening every page");
    assert.equal(browserWorkspaceState().liveTabCount, 0);
    assert.equal(browserWorkspaceState().suspendedTabCount, 2);
    const wake = await controlBrowserWorkspace("focus", b.sessionId, undefined, "agent-b");
    assert.ok(wake.ok);
    const restored = getBrowserSession(b.sessionId)!.page;
    assert.equal(browserWorkspaceState("agent-b").tabs.length, 2, "chat ownership survives restart");
    assert.equal(browserWorkspaceState("agent-a").tabs.length, 0);
    assert.equal(browserWorkspaceState("agent-b").selectedTabId, b.sessionId, "selection survives restart even when it is not the last tab");
    await closeBrowserSession({ sessionId: b2.sessionId });
    assert.equal(await restored.evaluate(() => localStorage.getItem("entry")), "user-edited");
    assert.match(await restored.evaluate(() => document.cookie), /liminal_fixture=persisted/);
    const value = await restored.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => { const req = indexedDB.open("fixture"); req.onsuccess = () => resolve(req.result); });
      const value = await new Promise(resolve => { const req = db.transaction("values").objectStore("values").get("key"); req.onsuccess = () => resolve(req.result); });
      db.close(); return value;
    });
    assert.equal(value, "persisted");
    assert.equal(browserWorkspaceState().tabs[0]!.paused, false, "restart alone must not require a human to resume");
    await controlBrowserWorkspace("pause", b.sessionId);
    await shutdownBrowserWorkspace(); await controlBrowserWorkspace("restore");
    assert.equal(browserWorkspaceState().tabs[0]!.paused, true, "explicit user takeover survives restart");
    await controlBrowserWorkspace("clear_history"); assert.deepEqual(browserWorkspaceState().history, []);
    await shutdownBrowserWorkspace();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await controlBrowserWorkspace("restore");
    assert.equal(browserWorkspaceState().tabs.length, 1, "offline restoration must preserve the tab");
    assert.equal(browserWorkspaceState().tabs[0]!.url, url);
  } finally {
    await shutdownBrowserWorkspace();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (prior === undefined) delete process.env.LIMINAL_BROWSER_DATA_DIR; else process.env.LIMINAL_BROWSER_DATA_DIR = prior;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("desktop broker correlates exact tabs, rejects other owners, and clears pending work", async () => {
  try {
    registerDesktopBrowser("desktop-owner", 12081);
    assert.throws(() => registerDesktopBrowser("other-window", 12082), /owns/);
    const poll = pollDesktopBrowser("desktop-owner");
    const requested = requestDesktopBrowserTab("open", "exact-tab-id");
    const command = await poll; assert.ok(command);
    assert.equal(command.tabId, "exact-tab-id");
    assert.throws(() => completeDesktopBrowserCommand("wrong-owner", command.id), /mismatch/);
    completeDesktopBrowserCommand("desktop-owner", command.id); await requested;
    const failed = requestDesktopBrowserTab("close", "exact-tab-id");
    const rejection = assert.rejects(failed, /stopped/);
    disconnectDesktopBrowser(); await rejection;
  } finally { disconnectDesktopBrowser(); }
});
