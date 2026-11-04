import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { audioRequestCancellation, handleTtsPost } from "./audio_http_handlers.js";
import { emitSpokenClips, installVoiceTtsFallback } from "./speak.js";
import type { AgentHarness } from "@liminal/core";

test("normal POST completion does not cancel speech, but response disconnect does",()=>{
  const req=new EventEmitter() as IncomingMessage;
  const res=new EventEmitter() as ServerResponse;
  const cancellation=audioRequestCancellation(req,res);
  req.emit("close");assert.equal(cancellation.signal.aborted,false);
  res.emit("close");assert.equal(cancellation.signal.aborted,true);
  cancellation.dispose();assert.equal(req.listenerCount("aborted"),0);assert.equal(res.listenerCount("close"),0);
});
test("a completed response does not abort the worker",()=>{
  const req=new EventEmitter() as IncomingMessage;
  const res=Object.assign(new EventEmitter(),{writableEnded:true}) as unknown as ServerResponse;
  const cancellation=audioRequestCancellation(req,res);
  res.emit("close");assert.equal(cancellation.signal.aborted,false);cancellation.dispose();
});
test("aborted HTTP, spoken tool and fallback calls never start synthesis or save clips",async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(handleTtsPost({chatId:"cancelled",getRuntimePreferences:()=>null,signal:controller.signal},{text:"Hello sir."}),/abort/i);
  const harness={} as AgentHarness;
  await assert.rejects(emitSpokenClips(harness,"Hello sir.",{} as never,controller.signal),/abort/i);
  installVoiceTtsFallback(harness);
  await assert.rejects(harness.voiceTtsFallback!("Hello sir.",controller.signal),/abort/i);
});
