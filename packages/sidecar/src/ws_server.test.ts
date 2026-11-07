import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { clientFrame, serverFrame, type AnyFrame, type ServerFrame } from "@liminal/protocol";
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

test('WsServer: accepted prompts reach watching clients before the reply, without echoing to the sender', async () => {
  const received = new Map<object, ServerFrame[]>();
  const socket = () => { const ws = {readyState:WebSocket.OPEN,send:(raw:string)=>received.get(ws)!.push(JSON.parse(raw))}; received.set(ws,[]); return ws; };
  const origin=socket(),desktop=socket(),viewer=socket(),unrelated=socket();
  const accepted=new Set<string>(),acks:boolean[]=[],relayed:ServerFrame[]=[];
  const bridge={isBusy:false,isAwaitingPersonaBootstrap:false,
    hasAcceptedRequest:(id?:string)=>!!id&&accepted.has(id),
    sendUserMessage:async(_text:string,options:{requestId?:string})=>{
      if(options.requestId)accepted.add(options.requestId);
      server.broadcast(serverFrame('text',{channel:'user',delta:'Starting now.'},'demo'));
    },
  };
  const server=Object.assign(Object.create(WsServer.prototype),{
    clients:new Set([origin,desktop,viewer,unrelated]),
    clientMeta:new Map([[origin,{role:'owner'}],[desktop,{role:'owner'}],[viewer,{role:'view',chatId:'demo'}],[unrelated,{role:'view',chatId:'other'}]]),
    cloudRelay:{forward:(raw:string)=>relayed.push(JSON.parse(raw))},
    registry:{get:(id:string)=>id==='demo'?bridge:undefined},
    ack:(_ws:unknown,_id:string,ok:boolean)=>acks.push(ok),
  }) as any;
  const send=(id:string,requestId:string,message:string,attachments?:unknown[])=>server.dispatch(origin,clientFrame(id,'send_message',{chatId:'demo',requestId,message,...(attachments?{attachments}: {})} as any));
  await send('one','request-1','  Build the launch workspace  ');
  assert.deepEqual(received.get(desktop)!.map(f=>f.event),['user_message','text']);
  assert.deepEqual(received.get(viewer)!.map(f=>f.event),['user_message','text']);
  assert.deepEqual(received.get(origin)!.map(f=>f.event),['text']);
  assert.deepEqual(received.get(unrelated),[]);
  assert.deepEqual(received.get(desktop)![0],serverFrame('user_message',{text:'Build the launch workspace',requestId:'request-1'},'demo'));
  await send('retry','request-1','Build the launch workspace');
  assert.equal(received.get(desktop)!.length,2);
  bridge.isBusy=true;await send('busy','request-2','Rejected');bridge.isBusy=false;
  bridge.isAwaitingPersonaBootstrap=true;await send('setup','request-3','Rejected');bridge.isAwaitingPersonaBootstrap=false;
  await send('invalid','x'.repeat(161),'Rejected');
  assert.equal(received.get(desktop)!.length,2);
  assert.deepEqual(acks,[true,true,false,false,false]);
  await send('file','request-4','',[{name:'brief.txt',mimeType:'text/plain',dataUrl:'data:text/plain;base64,cHJpdmF0ZS1maWxl',sizeBytes:12}]);
  const file=received.get(desktop)!.filter(f=>f.event==='user_message').at(-1)!;
  assert.deepEqual(file.data,{text:'',requestId:'request-4',attachmentPreviews:[{name:'brief.txt'}]});
  assert.doesNotMatch(JSON.stringify(file),/base64|dataUrl|cHJpdmF0ZS1maWxl/);
  assert.equal(relayed.filter(f=>f.event==='user_message').length,2);
});

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
