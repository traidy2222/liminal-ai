import test from "node:test";
import assert from "node:assert/strict";
import { clientFrame, type ClientFrame } from "@liminal/protocol";
import { WsServer } from "./ws_server.js";

test("send_message rejects busy/setup-gated speech before acknowledging or consuming it", async () => {
  let busy = true, bootstrap = false, starts = 0, touches = 0;
  const acknowledgements: Array<{ ok: boolean; error?: string }> = [];
  const bridge = {
    get isBusy() { return busy; },
    get isAwaitingPersonaBootstrap() { return bootstrap; },
    async sendUserMessage() { starts++; busy = true; },
  };
  // Exercise the real command dispatcher with only its transport/registry boundaries stubbed.
  const server = Object.assign(Object.create(WsServer.prototype), {
    clientRole: () => "owner",
    registry: { get: () => bridge, touch: () => { touches++; } },
    ack: (_ws: unknown, _id: string, ok: boolean, error?: string) => acknowledgements.push({ ok, error }),
    broadcastChatList: () => {}, broadcast: () => {},
  }) as { dispatch(ws: unknown, frame: ClientFrame): Promise<void> };
  const send = (id: string) => server.dispatch({}, clientFrame(id, "send_message", { chatId: "voice", message: id, liveDictation: true }));
  await send("busy");
  assert.equal(acknowledgements.at(-1)?.ok, false);
  assert.match(acknowledgements.at(-1)?.error ?? "", /busy/i);
  assert.equal(starts, 0); assert.equal(touches, 0);
  busy = false; bootstrap = true;
  await send("setup");
  assert.equal(acknowledgements.at(-1)?.ok, false);
  assert.equal(starts, 0);
  bootstrap = false;
  await send("accepted"); await send("concurrent");
  assert.deepEqual(acknowledgements.slice(-2).map(a => a.ok), [true, false]);
  assert.equal(starts, 1); assert.equal(touches, 1);
});
