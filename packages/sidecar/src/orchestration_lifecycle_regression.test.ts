import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatOrchestrator } from './chat_orchestrator.js';
const task={id:'a',title:'A',prompt:'A'};
test('stopping a worker prevents handoff repair turns',async()=>{
 let sends=0;let o:any;
 const bridge={chatId:'worker',beginSession:async()=>{},abort(){},harness:{getIsRunning:()=>false,getLastAssistantMessage:()=> 'invalid'},sendUserMessage:async()=>{sends++;o.stop();}};
 o=new ChatOrchestrator({registry:{create:async()=>bridge,touch(){},get:()=>bridge},emit(){}} as any);
 o.snapshot={id:'old',status:'running',workers:[{taskId:'a',title:'A',status:'pending'}]};
 await assert.rejects(o.runWorker('goal',task,[task],''));
 assert.equal(sends,1,'no model turn may start after stop');assert.equal(o.autopilotChats.size,0);
});
test('starting a new orchestration cannot revive an old pending worker',async()=>{
 let release!:()=>void, entered!:()=>void, sends=0;
 const ready=new Promise<void>(r=>{entered=r;}), waiting=new Promise<void>(r=>{release=r;});
 const bridge={chatId:'old-worker',beginSession:async()=>{entered();await waiting;},abort(){},harness:{getIsRunning:()=>false,getLastAssistantMessage:()=>JSON.stringify({status:'done',summary:'old'})},sendUserMessage:async()=>{sends++;}};
 const o=new ChatOrchestrator({registry:{create:async()=>bridge,touch(){},get:()=>bridge},emit(){}} as any) as any;
 o.snapshot={id:'old',status:'running',workers:[{taskId:'a',title:'A',status:'pending'}]};
 const work=o.runWorker('old',task,[task],'').catch(()=>undefined);await ready;o.stop();
 o.plan=async()=>({tasks:[]});const next=o.start('new');release();await work;await o.runChain;
 assert.equal(sends,0);assert.equal(o.getSnapshot().id,next.id);assert.equal(o.autopilotChats.size,0);
});
for(const outcome of ['failed','blocked'])test(`dependent worker is skipped after upstream ${outcome}`,async()=>{
 const tasks=[task,{id:'b',title:'B',prompt:'B',dependsOn:['a']},{id:'c',title:'C',prompt:'C'}], started:string[]=[];
 const o=new ChatOrchestrator({registry:{},emit(){}} as any) as any;
 o.snapshot={id:'run',status:'planning',workers:[]};o.plan=async()=>({tasks});
 o.runWorker=async(_goal:string,t:any)=>{started.push(t.id);if(t.id==='a'&&outcome==='failed')throw Error('upstream failure');return {status:t.id==='a'?'blocked':'done',summary:t.id,blockers:[],artifacts:[],commandsRun:[],decisions:[]};};
 o.runSynthesis=async()=>({chatId:'synthesis',text:'summary'});
 await o.execute('run','goal',3);
 assert.deepEqual(started,['a','c']);assert.equal(o.getSnapshot().workers.find((w:any)=>w.taskId==='b').status,'skipped');
});
