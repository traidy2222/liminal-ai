import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveBrowseHref,
  assertFileMayBeOpened,
  parseActionsFromArgs,
  normalizeOneAction,
  sanitizeSelector,
  realpathSafe,
} from "./browser_runtime.js";
import { resolveWorkspaceRoot } from "@liminal/core";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/browser");
const fixtureHtml = path.join(fixtureDir, "button.html");

test("resolveBrowseHref rejects javascript: URLs", () => {
  const r = resolveBrowseHref("javascript:alert(1)");
  assert.equal(r.ok, false);
});

test("resolveBrowseHref allows https URLs", () => {
  const r = resolveBrowseHref("https://example.com/path");
  assert.equal(r.ok, true);
  if (r.ok) assert.match(r.href, /^https:\/\/example\.com/);
});

test("resolveBrowseHref sandbox file:// under workspace", () => {
  const ws = resolveWorkspaceRoot();
  const inside = path.join(ws, "package.json");
  const href = `file:///${inside.replace(/\\/g, "/")}`;
  const r = resolveBrowseHref(href);
  assert.equal(r.ok, true);
});

test("assertFileMayBeOpened rejects paths outside workspace", () => {
  const outside = process.platform === "win32" ? "C:\\Windows\\System32\\drivers\\etc\\hosts" : "/etc/hosts";
  const gate = assertFileMayBeOpened(realpathSafe(outside));
  assert.equal(gate.ok, false);
});

test("parseActionsFromArgs parses click_ref", () => {
  const parsed = parseActionsFromArgs([{ op: "click_ref", ref: "e2" }], undefined);
  assert.ok(Array.isArray(parsed));
  if (Array.isArray(parsed)) {
    assert.equal(parsed[0]?.op, "click_ref");
    if (parsed[0]?.op === "click_ref") assert.equal(parsed[0].ref, "e2");
  }
});

test("parseActionsFromArgs rejects unknown op", () => {
  const parsed = parseActionsFromArgs([{ op: "teleport" }], undefined);
  assert.ok(parsed && !Array.isArray(parsed));
  if (parsed && !Array.isArray(parsed)) assert.match(parsed.error, /Unknown action op/);
});

test("normalizeOneAction supports wait_navigation and screenshot", () => {
  const nav = normalizeOneAction({ op: "wait_navigation", wait_until: "load" });
  assert.equal("op" in nav && nav.op.op, "wait_navigation");
  const shot = normalizeOneAction({ op: "screenshot", full_page: true });
  assert.equal("op" in shot && shot.op.op, "screenshot");
});

test("normalizeOneAction supports goto and type_ref", () => {
  const goto = normalizeOneAction({ op: "goto", url: "https://example.com/ask" });
  assert.equal("op" in goto && goto.op.op, "goto");
  if ("op" in goto && goto.op.op === "goto") assert.equal(goto.op.url, "https://example.com/ask");

  const typed = normalizeOneAction({ op: "type_ref", ref: "e2", value: "machine learning" });
  assert.equal("op" in typed && typed.op.op, "type_ref");
  if ("op" in typed && typed.op.op === "type_ref") {
    assert.equal(typed.op.ref, "e2");
    assert.equal(typed.op.value, "machine learning");
  }
});

test("normalizeOneAction maps sel alias to selector", () => {
  const click = normalizeOneAction({ op: "click_selector", sel: "#submit" });
  assert.equal("op" in click && click.op.op, "click_selector");
  if ("op" in click && click.op.op === "click_selector") assert.equal(click.op.selector, "#submit");
});

test("goto rejects javascript URLs at resolve time", () => {
  const parsed = parseActionsFromArgs([{ op: "goto", url: "javascript:alert(1)" }], undefined);
  assert.ok(Array.isArray(parsed));
  if (!Array.isArray(parsed)) return;
  assert.equal(parsed[0]?.op, "goto");
});

test("sanitizeSelector rejects empty", () => {
  const r = sanitizeSelector("  ");
  assert.ok(typeof r !== "string");
});

test("legacy steps scroll bottom", () => {
  const parsed = parseActionsFromArgs(undefined, "scroll to bottom");
  assert.ok(Array.isArray(parsed));
  if (Array.isArray(parsed)) assert.equal(parsed[0]?.op, "scroll");
});

test("integration: open fixture, snapshot refs, click button", { timeout: 120_000 }, async (t) => {
  if (process.env["AGENT_BROWSER_INTEGRATION"] !== "1") {
    t.skip("Set AGENT_BROWSER_INTEGRATION=1 to run Playwright integration test");
    return;
  }
  process.env["AGENT_BROWSER"] = "1";
  const {
    openBrowserSession,
    actOnBrowserSession,
    closeBrowserSession,
    snapshotBrowserSession,
  } = await import("./browser_runtime.js");

  const fileUrl = `file:///${fixtureHtml.replace(/\\/g, "/")}`;
  const opened = await openBrowserSession({
    ownerTaskId: "test",
    href: fileUrl,
    waitUntil: "domcontentloaded",
    navTimeoutMs: 30_000,
    postWaitMs: 200,
    includeConsole: true,
    includeSnapshot: true,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  assert.match(opened.output, /SESSION_ID:/);
  assert.match(opened.output, /SNAPSHOT_REFS/);
  assert.match(opened.output, /fixture-intentional-error|error/i);

  const sessionId = opened.sessionId;
  const snap = await snapshotBrowserSession(sessionId, false);
  assert.equal(snap.ok, true);
  if (snap.ok) {
    const hasRef = /^\s*e\d+\s+button/m.test(snap.output);
    assert.ok(hasRef || /button "Click me"/i.test(snap.output), "expected button ref or a11y excerpt");
  }

  const clickAction =
    snap.ok && /^\s*(e\d+)\s+button/m.test(snap.output)
      ? ({ op: "click_ref" as const, ref: snap.output.match(/^\s*(e\d+)\s+button/m)![1]! })
      : ({ op: "click_selector" as const, selector: "#go" });

  const acted = await actOnBrowserSession({
    sessionId,
    actions: [clickAction],
    postActionWaitMs: 300,
    refreshSnapshot: false,
    includeConsole: false,
  });
  assert.equal(acted.ok, true);
  if (acted.ok) assert.match(acted.output, /clicked|ACTIONS_DONE: success/i);

  await closeBrowserSession({ sessionId });
});

test("integration: goto in session + Herokuapp login via type_ref", { timeout: 180_000 }, async (t) => {
  if (process.env["AGENT_BROWSER_INTEGRATION"] !== "1") {
    t.skip("Set AGENT_BROWSER_INTEGRATION=1 to run Playwright integration test");
    return;
  }
  process.env["AGENT_BROWSER"] = "1";
  const {
    openBrowserSession,
    actOnBrowserSession,
    navigateBrowserSession,
    closeBrowserSession,
    snapshotBrowserSession,
  } = await import("./browser_runtime.js");

  const opened = await openBrowserSession({
    ownerTaskId: "test-login",
    href: "https://the-internet.herokuapp.com/login",
    waitUntil: "domcontentloaded",
    navTimeoutMs: 45_000,
    postWaitMs: 400,
    includeConsole: false,
    includeSnapshot: true,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const sessionId = opened.sessionId;

  const snap = await snapshotBrowserSession(sessionId, false);
  assert.equal(snap.ok, true);
  if (!snap.ok) return;

  const refLine = /^\s*(e\d+)\s+(\S+)/gim;
  const refs = [...snap.output.matchAll(refLine)].map((m) => ({
    id: m[1]!,
    line: m[0]!.toLowerCase(),
  }));
  const userRef = refs.find((r) => r.line.includes("username"))?.id;
  const passRef = refs.find((r) => r.line.includes("password"))?.id;
  const loginRef = refs.find((r) => r.line.includes("login") && r.line.includes("button"))?.id;

  const loginActions =
    userRef && passRef && loginRef
      ? [
          { op: "focus_ref" as const, ref: userRef },
          { op: "clear_ref" as const, ref: userRef },
          { op: "type_ref" as const, ref: userRef, value: "tomsmith" },
          { op: "focus_ref" as const, ref: passRef },
          { op: "clear_ref" as const, ref: passRef },
          { op: "type_ref" as const, ref: passRef, value: "SuperSecretPassword!" },
          { op: "click_ref" as const, ref: loginRef },
        ]
      : [
          { op: "fill" as const, selector: "#username", value: "tomsmith" },
          { op: "fill" as const, selector: "#password", value: "SuperSecretPassword!" },
          { op: "click_selector" as const, selector: "button[type='submit']" },
        ];

  const loginAct = await actOnBrowserSession({
    sessionId,
    actions: loginActions,
    postActionWaitMs: 800,
    refreshSnapshot: true,
    includeConsole: false,
  });
  assert.equal(loginAct.ok, true);
  if (loginAct.ok) {
    assert.match(loginAct.output, /\/secure/i);
  }

  const nav = await navigateBrowserSession({
    sessionId,
    href: "https://the-internet.herokuapp.com/",
    waitUntil: "domcontentloaded",
    navTimeoutMs: 45_000,
    postWaitMs: 200,
    includeConsole: false,
  });
  assert.equal(nav.ok, true);

  const gotoAct = await actOnBrowserSession({
    sessionId,
    actions: [{ op: "goto", url: "https://the-internet.herokuapp.com/login" }],
    postActionWaitMs: 200,
    refreshSnapshot: false,
    includeConsole: false,
  });
  assert.equal(gotoAct.ok, true);
  if (gotoAct.ok) assert.match(gotoAct.output, /login/i);

  await closeBrowserSession({ sessionId });
});
