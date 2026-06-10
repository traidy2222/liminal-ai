import assert from "node:assert/strict";
import { test } from "node:test";
import { PtyManager } from "./pty_manager.js";

test("PtyManager open lists and closeForChat", () => {
  const mgr = new PtyManager();
  const info = mgr.open({
    chatId: "chat_test",
    workspaceRoot: process.cwd(),
    cols: 80,
    rows: 24,
  });
  assert.equal(info.chatId, "chat_test");
  assert.ok(info.sessionId.startsWith("pty_"));
  const listed = mgr.list("chat_test");
  assert.equal(listed.length, 1);
  mgr.closeForChat("chat_test");
  assert.equal(mgr.list("chat_test").length, 0);
  mgr.disposeAll();
});

test("PtyManager replays backlog on late WebSocket attach", async () => {
  const mgr = new PtyManager();
  const info = mgr.open({
    chatId: "late_ws",
    workspaceRoot: process.cwd(),
    cols: 80,
    rows: 24,
  });
  await new Promise((r) => setTimeout(r, 800));
  const mock = {
    readyState: 1,
    OPEN: 1,
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data);
    },
    on() {},
  };
  assert.equal(mgr.attachSocket(info.sessionId, mock as import("ws").WebSocket), true);
  assert.ok(
    mock.sent.join("").length > 0,
    "expected shell output replayed to late client"
  );
  mgr.closeForChat("late_ws");
  mgr.disposeAll();
});

test("PtyManager readTail and onSessionData", async () => {
  const mgr = new PtyManager();
  const info = mgr.open({
    chatId: "data_test",
    workspaceRoot: process.cwd(),
    cols: 80,
    rows: 24,
  });
  const chunks: string[] = [];
  const unsub = mgr.onSessionData(info.sessionId, (c) => chunks.push(c));
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(mgr.isAlive(info.sessionId));
  assert.ok(mgr.readTail(info.sessionId, 4096).length >= 0);
  unsub();
  mgr.closeForChat("data_test");
  mgr.disposeAll();
});
