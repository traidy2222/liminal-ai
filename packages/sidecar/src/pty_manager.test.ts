import assert from "node:assert/strict";
import { test } from "node:test";
import { PtyManager } from "./pty_manager.js";

test("PtyManager open lists and closeForChat", (t) => {
  const mgr = new PtyManager();
  t.after(() => mgr.disposeAll());
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

test("PtyManager replays backlog on late WebSocket attach", async (t) => {
  const mgr = new PtyManager();
  t.after(() => mgr.disposeAll());
  const info = mgr.open({
    chatId: "late_ws",
    workspaceRoot: process.cwd(),
    cols: 80,
    rows: 24,
  });
  await writeAndWaitForMarker(mgr, info.sessionId);
  const mock = {
    readyState: 1,
    OPEN: 1,
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data);
    },
    on() {},
  };
  assert.equal(
    mgr.attachSocket(info.sessionId, mock as import("ws").WebSocket),
    true,
  );
  assert.ok(
    mock.sent.join("").includes("LIMINAL_REPLAY_READY"),
    "expected shell output replayed to late client",
  );
  mgr.closeForChat("late_ws");
  mgr.disposeAll();
});

test("PtyManager runOneshot runs plain command and returns output", async (t) => {
  const mgr = new PtyManager();
  t.after(() => mgr.disposeAll());
  const result = await mgr.runOneshot({
    chatId: "oneshot_test",
    workspaceRoot: process.cwd(),
    command: process.platform === "win32" ? "whoami" : "whoami",
    timeoutMs: 15_000,
  });
  assert.equal(result.exitCode, 0);
  assert.ok(result.sessionId.startsWith("pty_"));
  assert.ok(result.output.trim().length > 0);
  assert.ok(!result.output.includes("__LIMINAL_EXIT"));
  assert.equal(mgr.isAlive(result.sessionId), false);
  mgr.disposeAll();
});

test("PtyManager readTail and onSessionData", async (t) => {
  const mgr = new PtyManager();
  t.after(() => mgr.disposeAll());
  const info = mgr.open({
    chatId: "data_test",
    workspaceRoot: process.cwd(),
    cols: 80,
    rows: 24,
  });
  const chunks: string[] = [];
  const unsub = mgr.onSessionData(info.sessionId, (c) => chunks.push(c));
  await writeAndWaitForMarker(mgr, info.sessionId);
  assert.ok(mgr.isAlive(info.sessionId));
  assert.ok(
    mgr.readTail(info.sessionId, 4096).includes("LIMINAL_REPLAY_READY"),
  );
  assert.ok(chunks.join("").includes("LIMINAL_REPLAY_READY"));
  unsub();
  mgr.closeForChat("data_test");
  mgr.disposeAll();
});

/** Emit a marker whose full text is absent from command echo, then await actual output. */
async function writeAndWaitForMarker(
  mgr: PtyManager,
  id: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(Error("Shell did not produce marker within 15 seconds"));
    }, 15000);
    const unsub = mgr.onSessionData(id, () => {
      if (mgr.readTail(id, 8192).includes("LIMINAL_REPLAY_READY")) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
    const command =
      process.platform === "win32"
        ? "Write-Output ('LIMINAL_' + 'REPLAY_READY')\r"
        : "printf '%s%s\\n' 'LIMINAL_' 'REPLAY_READY'\r";
    if (!mgr.write(id, command)) {
      clearTimeout(timer);
      unsub();
      reject(Error("Shell closed before marker command"));
    }
  });
}

test("PtyManager drains final output and preserves a failing command exit code", async (t) => {
  const mgr = new PtyManager();
  t.after(() => mgr.disposeAll());
  const result = await mgr.runOneshot({
    chatId: "drain_test",
    workspaceRoot: process.cwd(),
    command: `node -e "process.stdout.write('x'.repeat(32768)+'\\nLIMINAL_FINAL\\n');process.exitCode=7"`,
    timeoutMs: 15000,
  });
  assert.equal(result.exitCode, 7, result.output.slice(-2500));
  assert.ok(result.output.length >= 32768);
  assert.ok(result.output.includes("LIMINAL_FINAL"));
  assert.equal(mgr.isAlive(result.sessionId), false);
});
