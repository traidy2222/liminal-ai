import test from 'node:test';import assert from 'node:assert/strict';
import {AgentHarness} from './agent.js';import {TaskCompletionLedger} from './task_completion.js';
const fixture=()=>new AgentHarness({openRouterApiKey:'offline',baseURL:'http://127.0.0.1:1',model:'offline',worldContext:{disabled:true},proceduralMemory:{enabled:false},runtimePreferences:{version:1,updatedAt:0,harness:{env:{AGENT_VERIFY_BEFORE_DONE:'0',AGENT_OUTCOME_JUDGE:'0'}}},context:{inceptionMessages:[],modelMaxTokens:100000,thresholdFraction:.9}});
test('unsupported final text is withheld from chat/TTS and bounded recovery ends explicitly incomplete',async()=>{
 const h=fixture(),s=h as any;s.lastUserMessage='Create the launch board and announcement';s.sendStartTime=Date.now();s.toolsUsedThisTurn=['browser_act'];s.taskCompletion=new TaskCompletionLedger(s.lastUserMessage,{idPrefix:'fixture'});s.taskCompletion.update({outcomes:['Save board','Add announcement']});
 let calls=0;s.streamWithRetry=async()=>{calls++;return(async function*(){yield{choices:[{index:0,delta:{content:'Everything is done.'},finish_reason:'stop'}]};})();};
 const text:string[]=[],ends:any[]=[];h.emitter.on('text',e=>{if(e.channel==='user')text.push(e.delta)});h.emitter.on('turn_end',e=>ends.push(e));
 try{await s.runReActLoop();assert.equal(calls,3);assert.equal(text.length,1);assert.match(text[0]!,/Work is incomplete.*Add announcement/);assert.ok(!h.getContext().getLastAssistantMessage()?.includes('Everything is done'));assert.equal(ends[0].harnessMetrics.terminationReason,'error');}finally{h.closeProcedureRuntime();}
});
test('supported completion streams once and never triggers a post-answer audit',async()=>{
 const h=fixture(),s=h as any;s.lastUserMessage='Create board';s.sendStartTime=Date.now();s.taskCompletion=new TaskCompletionLedger(s.lastUserMessage,{idPrefix:'fixture'});const ledger=s.taskCompletion as TaskCompletionLedger;const id=ledger.observe('browser_snapshot',true,'PAGE_CONTEXT: Launch board saved');ledger.update({outcomes:['Save board'],updates:[{id:'t1',status:'completed',evidence:[{observation_id:id!,quote:'Launch board saved'}]}]});
 let calls=0;s.streamWithRetry=async()=>{calls++;return(async function*(){yield{choices:[{index:0,delta:{content:'Board saved.'},finish_reason:'stop'}]};})();};const text:string[]=[];h.emitter.on('text',e=>{if(e.channel==='user')text.push(e.delta)});
 try{await s.runReActLoop();assert.equal(calls,1);assert.deepEqual(text,['Board saved.']);}finally{h.closeProcedureRuntime();}
});

test('a held final resumes only missing work, reconciles returned evidence and publishes one final',async()=>{
 const h=fixture(),s=h as any;s.lastUserMessage='Finish the page and announcement';s.sendStartTime=Date.now();s.taskCompletion=new TaskCompletionLedger(s.lastUserMessage,{idPrefix:'fixture'});const ledger=s.taskCompletion as TaskCompletionLedger;ledger.update({outcomes:['Finish page','Add announcement']});
 let work=0;h.registry.register({name:'browser_snapshot',description:'fixture',requiresApproval:false,parameters:{type:'object',properties:{}},handler:async()=>{work++;return {ok:true,output:'PAGE_CONTEXT: Landing page saved | Announcement ready'};}});
 h.registry.register({name:'plan',description:'fixture',requiresApproval:false,parameters:{type:'object',properties:{updates:{type:'array',items:{type:'object'}}}},handler:async(args:any)=>ledger.update(args)});
 let calls=0;s.streamWithRetry=async()=>{calls++;const n=calls;return(async function*(){
  if(n===1||n===4){yield{choices:[{index:0,delta:{content:n===1?'Everything is done.':'Page and announcement saved.'},finish_reason:'stop'}]};return;}
  const name=n===2?'browser_snapshot':'plan',args=n===2?{}:{updates:[{id:'t1',status:'completed',evidence:[{observation_id:'o-fixture-1',quote:'Landing page saved'}]},{id:'t2',status:'completed',evidence:[{observation_id:'o-fixture-1',quote:'Announcement ready'}]}]};
  yield{choices:[{index:0,delta:{tool_calls:[{index:0,id:'fixture-'+n,type:'function',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]};
 })();};
 const text:string[]=[],ends:any[]=[];h.emitter.on('text',e=>{if(e.channel==='user')text.push(e.delta)});h.emitter.on('turn_end',e=>ends.push(e));
 try{await s.runReActLoop();assert.equal(calls,4);assert.equal(work,1);assert.ok(!text.join('').includes('Everything is done'));assert.match(text.join(''),/Page and announcement saved/);assert.equal(ledger.pending.length,0);assert.equal(ends.length,1);assert.deepEqual(ends[0].harnessMetrics.taskCompletion,{requested:2,completed:2,pending:0,blocked:0,heldFinalReplies:1});}finally{h.closeProcedureRuntime();}
});
test('a tool-round limit reports unresolved work without another model summary',async()=>{
 const h=fixture(),s=h as any;s.lastUserMessage='Finish board';s.sendStartTime=Date.now();s.taskCompletion=new TaskCompletionLedger(s.lastUserMessage,{idPrefix:'fixture'});s.taskCompletion.update({outcomes:['Save board']});let calls=0;s.streamWithRetry=async()=>{calls++;throw Error('must not summarize unverified work');};const text:string[]=[],ends:any[]=[];h.emitter.on('text',e=>{if(e.channel==='user')text.push(e.delta)});h.emitter.on('turn_end',e=>ends.push(e));
 try{await s.finalizeAtToolRoundLimit();assert.equal(calls,0);assert.match(text.join(''),/Work is incomplete.*Save board/);assert.equal(ends[0].harnessMetrics.terminationReason,'round_cap');}finally{h.closeProcedureRuntime();}
});

test('an unconfigured browser workflow selects plan without changing the published tool catalog',async()=>{
 const h=fixture(),s=h as any;s.lastUserMessage='Get this workspace ready';s.sendStartTime=Date.now();const ledger=new TaskCompletionLedger(s.lastUserMessage,{idPrefix:'fixture'});s.taskCompletion=ledger;
 for(let i=0;i<3;i++)ledger.observe('browser_snapshot',true,'PAGE_CONTEXT: Launch board ready');
 h.registry.register({name:'plan',description:'fixture',requiresApproval:false,parameters:{type:'object',properties:{}},handler:async(args:any)=>ledger.update(args)});
 let calls=0;s.streamWithRetry=async(_m:any,tools:any[],_model:any,_budget:any,_abort:any,_surface:any,_rebuild:any,requiredTool:any)=>{calls++;const n=calls;assert.ok(tools.some(t=>t.function.name==='plan'));assert.equal(requiredTool,n===1?'plan':undefined);return(async function*(){
  if(n===1)yield{choices:[{index:0,delta:{tool_calls:[{index:0,id:'capture-outcomes',type:'function',function:{name:'plan',arguments:JSON.stringify({outcomes:['Launch board ready'],updates:[{id:'t1',status:'completed',evidence:[{observation_id:'o-fixture-3',quote:'Launch board ready'}]}]})}}]},finish_reason:'tool_calls'}]};
  else yield{choices:[{index:0,delta:{content:'Workspace ready.'},finish_reason:'stop'}]};
 })();};
 try{await s.runReActLoop();assert.equal(calls,2);assert.equal(ledger.pending.length,0);}finally{h.closeProcedureRuntime();}
});

test('aborting a held draft cannot persist an unsupported success reply on replay',async()=>{
 const h=fixture(),s=h as any;s.lastUserMessage='Finish board';s.sendStartTime=Date.now();s.taskCompletion=new TaskCompletionLedger(s.lastUserMessage,{idPrefix:'fixture'});s.taskCompletion.update({outcomes:['Save board']});const controller=new AbortController();s.currentTurnController=controller;
 s.streamWithRetry=async()=>{return(async function*(){yield{choices:[{index:0,delta:{content:'Everything is complete.'},finish_reason:null}]};controller.abort();yield{choices:[{index:0,delta:{content:' Done.'},finish_reason:'stop'}]};})();};
 const text:string[]=[];h.emitter.on('text',e=>{if(e.channel==='user')text.push(e.delta)});
 try{await assert.rejects(()=>s.runReActLoop(),/Turn stopped/);assert.equal(text.length,0);assert.equal(s.pendingAssistantTextThisSend,'');assert.ok(!h.getContext().getLastAssistantMessage()?.includes('Everything is complete'));}finally{h.closeProcedureRuntime();}
});
