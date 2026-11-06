import assert from "node:assert/strict";
import test from "node:test";
import { extractReasoningDeltaFromChunk } from "./reasoning_stream.js";
import {StreamAccumulator} from "./streaming.js";

test("native continuation data survives streamed tool rounds without leaking into visible text",()=>{
 const stream=new StreamAccumulator();
 const chunk=(delta:unknown)=>stream.processChunk({choices:[{delta,index:0,finish_reason:null}]} as never);
 chunk({reasoning_content:"first "});chunk({reasoning_content:"second"});
 chunk({reasoning_details:[{index:0,id:"r1",type:"reasoning.text",text:"a",format:"test"}]});
 chunk({reasoning_details:[{index:0,text:"b",signature:"signed"},{index:1,id:"r2",type:"reasoning.encrypted",data:"opaque"}]});
 chunk({content:"Visible result",tool_calls:[{index:0,id:"call1",function:{name:"read_file",arguments:'{"path":"fixture"}'}}]});
 assert.equal(stream.accumulatedText,"Visible result");
 assert.deepEqual(stream.accumulatedProviderReasoning,{reasoning_content:"first second",reasoning_details:[{index:0,id:"r1",type:"reasoning.text",text:"ab",format:"test",signature:"signed"},{index:1,id:"r2",type:"reasoning.encrypted",data:"opaque"}]});
 stream.reset();assert.deepEqual(stream.accumulatedProviderReasoning,{});
});

test("extractReasoningDeltaFromChunk reads reasoning string", () => {
  assert.equal(extractReasoningDeltaFromChunk({ reasoning: "step one" }), "step one");
});

test("extractReasoningDeltaFromChunk reads reasoning_content", () => {
  assert.equal(extractReasoningDeltaFromChunk({ reasoning_content: "alt field" }), "alt field");
});

test("extractReasoningDeltaFromChunk joins reasoning_details text", () => {
  assert.equal(
    extractReasoningDeltaFromChunk({
      reasoning_details: [{ type: "reasoning.text", text: "a" }, { text: "b" }],
    }),
    "ab"
  );
});

test("extractReasoningDeltaFromChunk returns null when empty", () => {
  assert.equal(extractReasoningDeltaFromChunk({ content: "hello" }), null);
});
