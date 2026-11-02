import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { clientFrame, type AnyFrame, type ServerFrame } from "@liminal/protocol";
import { WsServer } from "./ws_server.js";

/**
 * End-to-end transport test: boots the real WsServer (with a dummy provider so
 * no model is ever called), connects a WebSocket client, and exercises the
 * handshake + command round-trip. This validates auth, framing, the registry,
 * and real AgentHarness construction — everything up to (not including) a turn.
 */

const DUMMY_PROVIDER = {
  apiKey: "sk-dummy-offline",
  model: "dummy/model",
  baseURL: "https://example.invalid/v1",
} as const;

/**
 * Buffers every server frame from socket creation so a `waitFor` can match
 * frames that already arrived (avoids the listener-attach race where `hello`
 * lands before a per-call listener is wired).
 */
class FrameCollector {
  private readonly buffer: ServerFrame[] = [];
  private readonly waiters: Array<{ pred: (f: ServerFrame) => boolean; resolve: (f: ServerFrame) => void }> = [];

  constructor(ws: WebSocket) {
    ws.on("message", (raw: Buffer) => {
      let frame: AnyFrame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (frame.t !== "evt") return;
      this.buffer.push(frame);
      const idx = this.waiters.findIndex((w) => w.pred(frame));
      if (idx >= 0) {
        const [w] = this.waiters.splice(idx, 1);
        w!.resolve(frame);
      }
    });
  }

  waitFor(pred: (f: ServerFrame) => boolean, timeoutMs = 8000): Promise<ServerFrame> {
    const existing = this.buffer.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for frame")), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }
}

test("WsServer: handshake, auth, ping, and create_chat round-trip", async (t) => {
  const server = new WsServer({
    token: "test-token",
    provider: DUMMY_PROVIDER,
    runtimePreferences: null,
    repoRoot: process.cwd(),
  });
  const port = await server.listen();
  t.after(() => server.close());

  // A bad token is rejected at the HTTP upgrade: the client errors, never opens.
  await new Promise<void>((resolve, reject) => {
    const bad = new WebSocket(`ws://127.0.0.1:${port}?token=wrong`);
    bad.on("open", () => {
      bad.close();
      reject(new Error("connection should not have opened with a bad token"));
    });
    bad.on("error", () => resolve());
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=test-token`);
  const frames = new FrameCollector(ws);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
  t.after(() => ws.close());

  // 1. hello (starting) then sidecar_ready once the harness exists.
  const hello = await frames.waitFor((f) => f.event === "hello");
  const helloData = hello.data as { protocolVersion: number; starting?: boolean };
  assert.equal(helloData.protocolVersion, 1);
  assert.equal(helloData.starting, true);

  const ready = await frames.waitFor((f) => f.event === "sidecar_ready");
  const readyData = ready.data as { activeChatId: string; chats: unknown[] };
  assert.ok(readyData.activeChatId.length > 0, "an active chat should auto-exist");
  assert.ok(Array.isArray(readyData.chats));

  // 2. ping → pong + command_result.
  ws.send(JSON.stringify(clientFrame("p1", "ping", {})));
  await frames.waitFor((f) => f.event === "pong");
  const pingAck = await frames.waitFor(
    (f) => f.event === "command_result" && (f.data as { commandId: string }).commandId === "p1"
  );
  assert.equal((pingAck.data as { ok: boolean }).ok, true);

  // 3. create_chat → command_result with a new chatId + a chat_list broadcast.
  ws.send(JSON.stringify(clientFrame("c1", "create_chat", { title: "Second chat" })));
  const createAck = await frames.waitFor(
    (f) => f.event === "command_result" && (f.data as { commandId: string }).commandId === "c1"
  );
  const ackData = createAck.data as { ok: boolean; data?: { chatId: string } };
  assert.equal(ackData.ok, true);
  assert.ok(ackData.data?.chatId, "create_chat should return a chatId");

  const list = await frames.waitFor(
    (f) => f.event === "chat_list" && (f.data as { chats: unknown[] }).chats.length >= 2
  );
  const chats = (list.data as { chats: unknown[] }).chats;
  assert.ok(chats.length >= 2, "should now have at least two chats");
});

test("WsServer: get_inbox_status when watcher disabled", async (t) => {
  const server = new WsServer({
    token: "test-token",
    provider: DUMMY_PROVIDER,
    runtimePreferences: null,
    repoRoot: process.cwd(),
  });
  const port = await server.listen();
  t.after(() => server.close());

  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=test-token`);
  const frames = new FrameCollector(ws);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
  });
  t.after(() => ws.close());

  await frames.waitFor((f) => f.event === "sidecar_ready");

  ws.send(JSON.stringify(clientFrame("inbox1", "get_inbox_status", {})));
  const ack = await frames.waitFor(
    (f) => f.event === "command_result" && (f.data as { commandId: string }).commandId === "inbox1"
  );
  const ackData = ack.data as { ok: boolean; data?: { pendingCount: number } };
  assert.equal(ackData.ok, true);
  assert.equal(typeof ackData.data?.pendingCount, "number");
});
