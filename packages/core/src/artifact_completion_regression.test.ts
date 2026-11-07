import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {AgentHarness} from './agent.js';
import {ArtifactInvestigationLedger} from './artifact_investigation.js';

async function fixture(t: any, repair: boolean, cleanup?: "close" | "ignore") {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-artifact-completion-'));
 t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('liminal-artifact-completion-'));await fs.rm(root,{recursive:true,force:true});});
 const h=new AgentHarness({openRouterApiKey:'fixture',baseURL:'http://127.0.0.1:1',model:'fixture',workspaceRoot:root,runtimePreferences:{version:1,updatedAt:0,harness:{env:{AGENT_VERIFY_BEFORE_DONE:'1'}}},maxToolRoundsPerTurn:10,worldContext:{disabled:true},context:{inceptionMessages:[],modelMaxTokens:1000000,thresholdFraction:0.9}});
 const state=h as any;state.sendStartTime=Date.now();state.lastUserMessage='Inspect sample.bin and save findings.json and findings.md.';state.prepareMessagesForContextLimit=async(messages:unknown)=>messages;
 state.artifactInvestigation=new ArtifactInvestigationLedger({workspaceRoot:root,taskId:'fixture',goal:state.lastUserMessage});
 h.registry.register({name:'write_fixture',description:'Write known fixture reports',parameters:{type:'object',properties:{}},requiresApproval:false,handler:async()=>{await fs.writeFile(path.join(root,'findings.json'),JSON.stringify({observations:['Measured bytes'],unknowns:['Schema incomplete']}));await fs.writeFile(path.join(root,'findings.md'),'Measured byte observations; schema remains unverified.');return{ok:true,output:'Reports persisted'};}});
 h.registry.register({name:'mcp_rea_close_binary',description:'Close fixture native session',parameters:{type:'object',properties:{}},requiresApproval:false,handler:async()=>({ok:true,output:'{"result":null}'})});
 if(cleanup)state.artifactInvestigation.observeToolResult({name:'mcp_rea_open_binary',args:{},result:{ok:true,output:'{"result":{"kind":"executable"}}'}});
 h.registry.activate(['write_fixture','mcp_rea_close_binary']);
 let stream=0;state.streamWithRetry=async()=> (async function*(){const current=++stream;const useTool=repair&&current===2;const close=cleanup==='close'&&current===4;yield{choices:[{index:0,delta:useTool||close?{tool_calls:[{index:0,id:'write',type:'function',function:{name:close?'mcp_rea_close_binary':'write_fixture',arguments:'{}'}}]}:{content:'Findings are complete.'},finish_reason:useTool||close?'tool_calls':'stop'}]};})();
 const ends:any[]=[];h.emitter.on('turn_end',event=>ends.push(event));
 await state.runReActLoop();
 const context=h.getContext().getConversationMessages().map(message=>typeof message.content==='string'?message.content:'').join('\n');
 return{root,stream,context,ends};
}

test('an artifact final reply cannot claim success with missing requested reports',async(t)=>{
 const result=await fixture(t,false);
 assert.equal(result.stream,2,'only one corrective continuation is allowed');
 assert.equal((result.context.match(/ARTIFACT FINDINGS NOT PERSISTED/g)??[]).length,1);
 assert.match(result.context,/requested findings are missing or invalid/);
 assert.equal(result.ends.length,1);assert.equal(result.ends[0].harnessMetrics.terminationReason,'error');
});

test('the continuation completes only after the actual JSON and Markdown exist on disk',async(t)=>{
 const result=await fixture(t,true);
 assert.equal(result.stream,4);assert.equal(result.ends.length,1);assert.equal(result.ends[0].harnessMetrics.terminationReason,'ok');
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(result.root,'findings.json'),'utf8')).unknowns,['Schema incomplete']);
 assert((await fs.readFile(path.join(result.root,'findings.md'),'utf8')).includes('unverified'));
});

test('the real configured round limit preserves an explicit incomplete artifact handoff',async(t)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-artifact-completion-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
 const h=new AgentHarness({openRouterApiKey:'fixture',baseURL:'http://127.0.0.1:1',model:'fixture',workspaceRoot:root,maxToolRoundsPerTurn:2,worldContext:{disabled:true},context:{inceptionMessages:[],modelMaxTokens:1000000,thresholdFraction:0.9}});
 const state=h as any;state.sendStartTime=Date.now();state.lastUserMessage='Inspect sample.bin';state.prepareMessagesForContextLimit=async(messages:unknown)=>messages;state.artifactInvestigation=new ArtifactInvestigationLedger({workspaceRoot:root,taskId:'capped',goal:state.lastUserMessage});
 let executions=0,streams=0;h.registry.register({name:'inspect_fixture',description:'Known fixture',parameters:{type:'object',properties:{}},requiresApproval:false,handler:async()=>{executions++;return{ok:true,output:'Measured byte observation'};}});h.registry.activate(['inspect_fixture']);
 const toolCounts:number[]=[];
 state.streamWithRetry=async(_messages:unknown,tools:unknown[])=> (async function*(){toolCounts.push(tools.length);const n=++streams;yield{choices:[{index:0,delta:{tool_calls:[{index:0,id:'probe-'+n,type:'function',function:{name:'inspect_fixture',arguments:'{}'}}]},finish_reason:'tool_calls'}]};})();
 const text:string[]=[];const ends:any[]=[];const errors:unknown[]=[];h.emitter.on('error',e=>errors.push(e));h.emitter.on('text',e=>{if(e.channel==='user')text.push(e.delta);});h.emitter.on('turn_end',e=>ends.push(e));await state.runReActLoop();
 assert.equal(executions,2);assert.equal(streams,3);assert.equal(toolCounts.at(-1),0,'the final request cannot perform more work');assert.equal(errors.length,0);assert.match(text.join(''),/configured tool-round limit \(2\).*remaining work is incomplete/s);assert.equal(text.length,1,'publish one final handoff');assert.equal(ends.length,1);assert.equal(ends[0].harnessMetrics.terminationReason,'round_cap');
 const checkpoints=await fs.readdir(path.join(root,'.agent_artifacts/investigations'));assert.equal(checkpoints.length,1);const checkpoint=JSON.parse(await fs.readFile(path.join(root,'.agent_artifacts/investigations',checkpoints[0]!,'checkpoint.json'),'utf8'));assert.equal(checkpoint.status,'incomplete');
});


test('one evidence review pass finishes only after an owned native close is acknowledged',async(t)=>{
 const result=await fixture(t,true,'close');assert.equal(result.stream,5);assert.equal(result.ends[0].harnessMetrics.terminationReason,'ok');
 assert.equal((result.context.match(/ARTIFACT FINAL EVIDENCE REVIEW/g)??[]).length,1);assert.doesNotMatch(result.context,/UNFINISHED NATIVE CLEANUP/);
});

test('ignored native cleanup is bounded and cannot be reported as successful completion',async(t)=>{
 const result=await fixture(t,true,'ignore');assert.equal(result.stream,5);assert.equal(result.ends[0].harnessMetrics.terminationReason,'error');
 assert.equal((result.context.match(/ARTIFACT FINAL EVIDENCE REVIEW/g)??[]).length,1);assert.equal((result.context.match(/UNFINISHED NATIVE CLEANUP/g)??[]).length,1);assert.match(result.context,/cleanup has not been verified/);
});
