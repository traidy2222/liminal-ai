import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
// Exercise the compiled page evaluators, just as the installed harness does.
import { openBrowserSession, getBrowserSession, browserWorkspaceState, controlBrowserWorkspace,
  hibernateIdleBrowserTabs, closeBrowserSession, closeAllBrowserSessionsForTask,
  registerBrowserTurnCleanup, shutdownBrowserWorkspace } from "../../../dist/families/browser/browser_runtime.js";
import { browserSnapshotTool } from "../../../dist/families/browser/browser_tools.js";
import { withBrowserTask } from "../../../dist/families/browser/browser_queue.js";
import { startBrowserScreencast, subscribeBrowserScreencast, unsubscribeBrowserScreencast,
  browserScreencastHasSubscribers } from "../../../dist/families/browser/browser_screencast.js";

test("idle browser releases pages, preserves logins and wakes exact chat tabs", { skip: process.env.AGENT_BROWSER_INTEGRATION !== "1" }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "liminal-browser-idle-"));
  const prior = process.env.LIMINAL_BROWSER_DATA_DIR;
  const priorLimit = process.env.AGENT_BROWSER_MAX_LIVE_TABS;
  process.env.LIMINAL_BROWSER_DATA_DIR = root;
  process.env.AGENT_BROWSER_MAX_LIVE_TABS = "4";
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end('<title>Idle fixture</title><label>Draft<input id="draft"></label>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/`;
  const open = async (ownerTaskId: string) => {
    const result = await openBrowserSession({ ownerTaskId, href: url, waitUntil: "load", navTimeoutMs: 5000,
      postWaitMs: 0, includeConsole: false, includeSnapshot: false });
    assert.ok(result.ok, result.ok ? "" : result.error); return result.sessionId;
  };
  const sweep = () => hibernateIdleBrowserTabs(Date.now() + 700_000);
  try {
    const a = await open("sleep-a"), b = await open("sleep-b");
    const pageA = getBrowserSession(a)!.page, pageB = getBrowserSession(b)!.page;
    await pageA.evaluate(() => { localStorage.setItem("idle-login", "kept"); document.cookie = "idle_login=kept; max-age=3600; path=/"; });
    await controlBrowserWorkspace("pause", a);
    await controlBrowserWorkspace("show", b, undefined, "sleep-b");
    assert.equal(await sweep(), 0, "takeover and visible tabs stay live");
    await controlBrowserWorkspace("hide", b);
    await controlBrowserWorkspace("resume", a);
    let busy = true;
    registerBrowserTurnCleanup({ taskId: "sleep-a", getIsRunning: () => busy });
    assert.equal(await withBrowserTask("sleep-b", sweep), 0, "agent turns and queued browser work stay live");
    busy = false;
    await pageB.locator("#draft").fill("unsaved work");
    const context = pageA.context(), originalCdp = context.newCDPSession.bind(context);
    let stoppedStreams = 0;
    context.newCDPSession = async page => {
      const cdp = await originalCdp(page), send = cdp.send.bind(cdp);
      cdp.send = (async (method: string, params?: never) => {
        if (method === "Page.stopScreencast") stoppedStreams++;
        return send(method as never, params);
      }) as typeof cdp.send;
      return cdp;
    };
    await startBrowserScreencast(a);
    const ws = { readyState: 1, send() {}, close() {}, on() {} };
    subscribeBrowserScreencast(a, ws);
    assert.equal(browserScreencastHasSubscribers(a), true);
    assert.equal(await sweep(), 0, "an open web viewer and unsaved form data stay live");
    unsubscribeBrowserScreencast(a, ws);
    await new Promise(resolve => setTimeout(resolve, 1800));
    assert.equal(stoppedStreams, 1, "last viewer disconnect releases the CDP screencast");
    context.newCDPSession = originalCdp;
    await pageB.locator("#draft").fill("");
    assert.equal(await sweep(), 2);
    assert.equal(pageA.isClosed(), true); assert.equal(pageB.isClosed(), true);
    assert.equal(browserWorkspaceState().liveTabCount, 0);
    assert.equal(browserWorkspaceState().suspendedTabCount, 2);
    assert.equal(browserWorkspaceState("sleep-a").selectedTabId, a);
    const beforeClose = context.pages().length;
    await closeBrowserSession({ sessionId: b });
    assert.equal(context.pages().length, beforeClose, "closing a sleeping tab never loads it");
    const wake = await browserSnapshotTool.handler({ session_id: a }, undefined, { taskId: "sleep-a" } as never);
    assert.ok(wake.ok, wake.ok ? "" : wake.error);
    const awake = getBrowserSession(a)!;
    assert.notEqual(awake.page, pageA);
    assert.equal(await awake.page.evaluate(() => localStorage.getItem("idle-login")), "kept");
    assert.match(await awake.page.evaluate(() => document.cookie), /idle_login=kept/);
    for (let i = 0; i < 5; i++) {
      await open(`capacity-${i}`);
      assert.ok(browserWorkspaceState().liveTabCount <= 4, "live pages are bounded across chats");
    }
    assert.equal(browserWorkspaceState().tabs.length, 6, "capacity eviction preserves dormant tab metadata");
    await closeAllBrowserSessionsForTask("sleep-a", { includePaused: true });
    assert.equal(browserWorkspaceState("sleep-a").tabs.length, 0, "deleting a chat removes sleeping tabs too");
  } finally {
    await shutdownBrowserWorkspace();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (prior === undefined) delete process.env.LIMINAL_BROWSER_DATA_DIR; else process.env.LIMINAL_BROWSER_DATA_DIR = prior;
    if (priorLimit === undefined) delete process.env.AGENT_BROWSER_MAX_LIVE_TABS; else process.env.AGENT_BROWSER_MAX_LIVE_TABS = priorLimit;
    await fs.rm(root, { recursive: true, force: true });
  }
});
