import test from 'node:test';import assert from 'node:assert/strict';
import {AgentHarness} from './agent.js';import {ArtifactInvestigationLedger} from './artifact_investigation.js';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
const fixture=()=>new AgentHarness({openRouterApiKey:'offline',baseURL:'http://127.0.0.1:1',model:'offline',worldContext:{disabled:true},proceduralMemory:{enabled:false},runtimePreferences:{version:1,updatedAt:0,harness:{env:{AGENT_VERIFY_BEFORE_DONE:'0',AGENT_OUTCOME_JUDGE:'0'}}},context:{inceptionMessages:[],modelMaxTokens:100000,thresholdFraction:.9}});
for(const reply of ['Done.','Saved.','23°C.'])test(`completed reply is terminal: ${reply}`,async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-completion-'));const h=fixture(),state=h as any;let calls=0,checks=0;
 state.lastUserMessage='Save findings.json and findings.md';state.sendStartTime=Date.now();state.toolsUsedThisTurn=['browser_search','vault_write'];
 state.artifactInvestigation=new ArtifactInvestigationLedger({workspaceRoot:root,taskId:'done',goal:state.lastUserMessage});
 state.artifactInvestigation.verifyReports=async()=>{checks++;throw Error('Must not verify after the final reply');};
 state.streamWithRetry=async()=>{calls++;return(async function*(){yield{choices:[{index:0,delta:{content:reply},finish_reason:'stop'}]};})();};
 const ends:unknown[]=[];h.emitter.on('turn_end',e=>ends.push(e));
 try{await state.runReActLoop();assert.equal(calls,1);assert.equal(checks,0);assert.equal(ends.length,1);}finally{h.closeProcedureRuntime();await rm(root,{recursive:true,force:true});}
});
test('missing answer gets one tool-free completion without a verification loop',async()=>{
 const h=fixture(),state=h as any;state.lastUserMessage='Read the result';state.toolsUsedThisTurn=['browser_search','browser_extract'];state.sendStartTime=Date.now();
 const toolCounts:number[]=[];state.streamWithRetry=async(_messages:unknown,tools:unknown[])=>{toolCounts.push(tools.length);const count=toolCounts.length;return(async function*(){yield{choices:[{index:0,delta:count===1?{}:{content:'Result saved.'},finish_reason:'stop'}]};})();};
 const ends:unknown[]=[];h.emitter.on('turn_end',e=>ends.push(e));await state.runReActLoop();assert.equal(toolCounts.length,2);assert.equal(toolCounts[1],0);assert.equal(ends.length,1);assert.equal(h.getContext().getLastAssistantMessage(),'Result saved.');
});
