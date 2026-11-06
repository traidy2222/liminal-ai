import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rankProviderEndpoints, WarmEndpointChoices, warmProviderValueCatalog, selectProviderValueEndpoint, selectedProviderEndpoint, type ProviderEndpoint, type ProviderObservation } from "./provider_value_routing.js";

const model="test/model";
const endpoint=(provider_name:string,tag:string,prompt:number,completion:number,tps?:number,latency=500):ProviderEndpoint=>({provider_name,tag,pricing:{prompt:String(prompt/1e6),completion:String(completion/1e6)},throughput_last_30m:tps,latency_last_30m:tps?latency:null,supported_parameters:["tools"]});
const options={model,inputTokens:8000,outputTokens:500,minTps:80,maxLatencySeconds:1};

test("value ranking weighs input/output cost and observed TPS rather than headline input price",()=>{
  const ranked=rankProviderEndpoints([
    endpoint("Slow cheap","slow",.006,.50,35,9000),
    endpoint("Good value","value",.038,.50,160,400),
    endpoint("Expensive fast","expensive",.3,1.2,180,300),
  ],[],options);
  assert.equal(ranked[0]?.tag,"value");
  assert.equal(ranked.at(-1)?.tag,"slow");
});

test("authenticated endpoint percentile objects use millisecond latency",()=>{
  const e={...endpoint("Fast","fast",.03,.5),latency_last_30m:{p50:378,p90:1302},throughput_last_30m:{p50:186,p90:85}};
  const ranked=rankProviderEndpoints([e],[],options);
  assert.equal(ranked[0]?.ttftMs,378);assert.equal(ranked[0]?.tps,186);
});

test("real telemetry fills missing catalog speed without fabricating unknown measurements",()=>{
  const rows:ProviderObservation[]=Array.from({length:3},()=>({model,provider:"Measured",scope:"agent",ts:new Date().toISOString(),ttftMs:600,latencyMs:4600,outputTokens:600,inputTokens:8000,cachedTokens:7000}));
  const ranked=rankProviderEndpoints([endpoint("Unmeasured","unknown",.001,.1),endpoint("Measured","measured",.006,.5)],rows,options);
  assert.equal(ranked.length,1);assert.equal(ranked[0]?.tag,"measured");assert.equal(ranked[0]?.tps,150);
});

test("cache read cost affects value and flex/priority variants do not leak speed into standard routes",()=>{
  const rows:ProviderObservation[]=Array.from({length:3},()=>({model,provider:"A",scope:"agent",ts:new Date().toISOString(),ttftMs:500,latencyMs:5500,outputTokens:600,inputTokens:10000,cachedTokens:9500,providerEndpoint:"a/standard"}));
  const a={...endpoint("A","a/standard",.1,.5),pricing:{prompt:"0.0000001",completion:"0.0000005",input_cache_read:"0.000000001"}};
  const ranked=rankProviderEndpoints([a,{...endpoint("A","a/flex",.001,.01,500),service_tier:"flex"},endpoint("B","b",.03,.5,120)],rows,options);
  assert.equal(ranked[0]?.tag,"a/standard");assert.equal(ranked.some(e=>e.tag==="a/flex"),false);
});

test("provider allowlists, ignore lists, price caps and tool support constrain ranking",()=>{
  const endpoints=[endpoint("A","a/us",.05,.5,100),endpoint("B","b/us",.1,.6,120)];
  assert.equal(rankProviderEndpoints(endpoints,[],{...options,only:["B"]})[0]?.tag,"b/us");
  assert.equal(rankProviderEndpoints(endpoints,[],{...options,ignore:["A"]})[0]?.tag,"b/us");
  assert.equal(rankProviderEndpoints(endpoints,[],{...options,maxPrice:{prompt:.04}}).length,0);
  assert.equal(rankProviderEndpoints([{...endpoints[0]!,supported_parameters:[]}],[],{...options,requireTools:true}).length,0);
  assert.equal(rankProviderEndpoints([{...endpoints[0]!,context_length:4096}],[],options).length,0);
});

test("unknown endpoint variants do not inherit another variant's observed performance",()=>{
  const rows:ProviderObservation[]=Array.from({length:3},()=>({model,provider:"Same brand",scope:"agent",ts:new Date().toISOString(),ttftMs:400,latencyMs:4400,outputTokens:600}));
  assert.deepEqual(rankProviderEndpoints([endpoint("Same brand","brand/a",.03,.5),endpoint("Same brand","brand/b",.04,.5)],rows,options),[]);
});

test("a healthy warm endpoint survives small value changes and is reconsidered after idle or exclusion",()=>{
  const state=new WarmEndpointChoices();const a={tag:"a/us",provider:"A",tps:150,ttftMs:500,expectedCostUsd:.001,score:.003,samples:3};
  const b={...a,tag:"b/us",provider:"B",score:.002};
  assert.equal(state.choose("chat-policy",[a,b],1000)?.tag,"a/us");
  assert.equal(state.choose("chat-policy",[b,a],2000)?.tag,"a/us","avoid re-colding a healthy cache");
  const restored=new WarmEndpointChoices();for(const [k,v] of JSON.parse(JSON.stringify([...state.entries])))restored.entries.set(k,v);
  assert.equal(restored.choose("chat-policy",[b,a],3000)?.tag,"a/us","restart retains the warm exact endpoint");
  assert.equal(state.choose("chat-policy",[b,a],603000)?.tag,"b/us");
  assert.equal(restored.choose("chat-policy",[b],4000)?.tag,"b/us","excluded or unhealthy endpoints are not kept");
});

test("catalog refresh is authenticated/coalesced and endpoint diagnostics stay scoped to the requesting chat",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"liminal-value-route-")),priorRoot=process.env.AGENT_GLOBAL_STORAGE_ROOT,priorFetch=globalThis.fetch;
  process.env.AGENT_GLOBAL_STORAGE_ROOT=root;let calls=0;
  globalThis.fetch=(async(_url,init)=>{calls++;assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer fixture-key");return new Response(JSON.stringify({data:{endpoints:[endpoint("A","a/us",.03,.5,150),endpoint("B","b/us",.06,.5,100)]}}),{status:200});}) as typeof fetch;
  try{
    await Promise.all([warmProviderValueCatalog("fixture/value-route","fixture-key"),warmProviderValueCatalog("fixture/value-route","fixture-key")]);assert.equal(calls,1);
    const opts={...options,model:"fixture/value-route",sessionId:"chat-a",policy:"adaptive"};
    assert.equal(selectProviderValueEndpoint(opts)?.tag,"a/us");
    assert.equal(selectProviderValueEndpoint({...opts,sessionId:"chat-b",only:["B"]})?.tag,"b/us");
    assert.equal(selectedProviderEndpoint(opts.model,"chat-a","A"),"a/us");
    assert.equal(selectedProviderEndpoint(opts.model,"chat-b","A"),undefined,"a fallback must not be labelled as the planned endpoint");
    assert.equal(selectedProviderEndpoint(opts.model,"chat-b","B"),"b/us");
    assert.equal(Object.keys(JSON.parse(await fs.readFile(path.join(root,"provider_endpoint_routes.json"),"utf8"))).length,2);
  }finally{globalThis.fetch=priorFetch;if(priorRoot===undefined)delete process.env.AGENT_GLOBAL_STORAGE_ROOT;else process.env.AGENT_GLOBAL_STORAGE_ROOT=priorRoot;assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});}
});
