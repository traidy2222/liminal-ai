import test from "node:test";
import assert from "node:assert/strict";
import { AgentEmitter, type AgentHarness, type ContextSnapshot } from "@liminal/core";
import { SessionBridge } from "./session_bridge.js";
import type { ServerFrame } from "@liminal/protocol";
const snapshot: ContextSnapshot={tokenCount:10,maxTokens:1000,usageFraction:.01,masked:false};

test("post-turn trace cannot reopen busy while send cleanup is unwinding", t=>{
  const emitter=new AgentEmitter(), frames:ServerFrame[]=[];

  const harness={emitter,getIsRunning:()=>true,getToolExecutionScope:()=>"voice-heartbeat-test"} as unknown as AgentHarness;
  const bridge=new SessionBridge(harness,"voice-test",process.cwd(),f=>frames.push(f));
  t.after(()=>bridge.dispose());
  emitter.emit("send_start",{userMessage:"hello",agentDepth:0});
  emitter.emit("text",{channel:"user",delta:"Hello."});
  emitter.emit("turn_end",{contextSnapshot:snapshot,durationMs:1});
  const terminal=frames.findIndex(f=>f.event==="turn_end");
  // The real installed app produced this exact ordering in the same millisecond.
  emitter.emit("text",{channel:"trace",delta:"Background turn cleanup complete."});
  assert.deepEqual(frames.slice(terminal+1).filter(f=>f.event==="harness_running"),[]);

});

test("the next actual send re-arms busy without inheriting a retired heartbeat", t=>{
  const emitter=new AgentEmitter(), frames:ServerFrame[]=[];
  const harness={emitter,getIsRunning:()=>true,getToolExecutionScope:()=>"voice-next-test"} as unknown as AgentHarness;
  const bridge=new SessionBridge(harness,"voice-next",process.cwd(),f=>frames.push(f));
  t.after(()=>bridge.dispose());
  for(let turn=0;turn<3;turn++){
    const at=frames.length;
    emitter.emit("send_start",{userMessage:"next",agentDepth:0});
    assert.ok(frames.slice(at).some(f=>f.event==="harness_running"),"new sends need their own running signal");
    emitter.emit("text",{channel:"user",delta:"Reply."});
    if (turn === 1) emitter.emit("error", {err: new Error("Provider unavailable")});
    else emitter.emit("turn_end",{contextSnapshot:snapshot,durationMs:1});
    const terminal=frames.length;
    emitter.emit("text",{channel:"trace",delta:"Post-turn statistics."});
    assert.deepEqual(frames.slice(terminal).map(f=>f.event),["text"]);
  }
});
