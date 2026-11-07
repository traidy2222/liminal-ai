import test from "node:test";
import assert from "node:assert/strict";
import { isRecoverableToolFailure } from "./tool_circuit.js";
import {ToolRegistry} from './registry.js';
import {ToolDispatcher} from './dispatcher.js';
import {AgentEmitter} from './events.js';

test('correctable visual challenge failures do not disable CAPTCHA tools; service failures do',async()=>{
 for(const error of ['VISIBLE_VISUAL_CHALLENGE: inspect the page','VISUAL_CHALLENGE_CHANGED: inspect again','INVALID_VISUAL_SOLUTION: source is not destination','Unknown visual ref. Use captcha_inspect','source_region must bound the loose piece. No paid task submitted.'])
  assert.equal(isRecoverableToolFailure('captcha_drag',{ok:false,error}),true,error);
 for(const error of ['2captcha HTTP 503','ERROR_ZERO_BALANCE','AGENT_CAPTCHA_KEY is not set','2captcha timed out after 120000ms','Target page, context or browser has been closed'])
  assert.equal(isRecoverableToolFailure('captcha_drag',{ok:false,error}),false,error);
 const registry=new ToolRegistry();let attempts=0;
 registry.register({name:'captcha_drag',description:'fixture',parameters:{type:'object',properties:{}},requiresApproval:false,handler:async()=>{attempts++;return attempts<5?{ok:false,error:'INVALID_VISUAL_SOLUTION: source is not destination'}:{ok:true,output:'pending_submission'};}});
 const dispatcher=new ToolDispatcher(registry,new AgentEmitter());
 for(let i=0;i<4;i++)assert.equal((await dispatcher.dispatch('correctable-'+i,'captcha_drag','{}')).ok,false);
 assert.equal((await dispatcher.dispatch('corrected','captcha_drag','{}')).ok,true);assert.equal(attempts,5);
});

test('procedure preflight rejection does not disable a healthy write tool', async () => {
 const registry = new ToolRegistry(); let calls = 0;
 registry.register({name:'write_file',description:'fixture',parameters:{type:'object',properties:{path:{type:'string'}}},requiresApproval:false,handler:async()=>{calls++;return {ok:true,output:'written'};}});
 const dispatcher = new ToolDispatcher(registry,new AgentEmitter());
 dispatcher.setExecutionGuard(async()=>{throw new Error('Procedure adoption required');});
 for(let i=0;i<3;i++) assert.equal((await dispatcher.dispatch(`guard-${i}`,'write_file',JSON.stringify({path:`file-${i}`}))).ok,false);
 dispatcher.setExecutionGuard(undefined);
 assert.equal((await dispatcher.dispatch('corrected-write','write_file','{"path":"approved-file"}')).ok,true);
 assert.equal(calls,1);
});

test('correctable browser actions do not trip the backend circuit; closed targets do',()=>{
 for(const error of ['Unknown ref "e1"','browser_act step 2: locator.click: Timeout 500ms exceeded','wait_ms: ms is required'])
  assert.equal(isRecoverableToolFailure('browser_act',{ok:false,error}),true);
 assert.equal(isRecoverableToolFailure('browser_act',{ok:false,error:'browser_act step 2: Target page, context or browser has been closed'}),false);
 assert.equal(isRecoverableToolFailure('browser_wait_for',{ok:false,error:'Timeout waiting for URL to contain "dashboard" (current: https://example.test/onboard)'}),true);
 assert.equal(isRecoverableToolFailure('browser_credentials',{ok:false,error:'ACCOUNT_EVIDENCE_REQUIRED: quote the current page'}),true);
 assert.equal(isRecoverableToolFailure('browser_credentials',{ok:false,error:'Account evidence was not found on the current page.'}),true);
 assert.equal(isRecoverableToolFailure('browser_credentials',{ok:false,error:'Saved login operation failed. Check the encrypted credential store.'}),false);
});

test("recoverable recall miss does not count as circuit failure", () => {
  assert.equal(
    isRecoverableToolFailure("recall", {
      ok: false,
      error: 'No note found for key "x". Use search_memory if the key is uncertain.',
    }),
    true
  );
});

test("hard recall errors still count", () => {
  assert.equal(
    isRecoverableToolFailure("recall", { ok: false, error: "notes store corrupt" }),
    false
  );
});

test("read_file ENOENT is recoverable", () => {
  assert.equal(
    isRecoverableToolFailure("read_file", {
      ok: false,
      error: "ENOENT: no such file or directory",
    }),
    true
  );
});

test('a failed script does not disable run_shell for a corrected command', async()=>{
 const registry=new ToolRegistry();let calls=0;
 registry.register({name:'run_shell',description:'owned script fixture',parameters:{type:'object',properties:{command:{type:'string'}},required:['command']},requiresApproval:false,
 handler:async args=>{calls++;return args.command==='corrected'?{ok:true,output:'Repaired parser output'}:{ok:false,error:'Exit code 1.\nValueError: incorrect parser offset'};}});
 const dispatcher=new ToolDispatcher(registry,new AgentEmitter());
 for(let i=0;i<3;i++)assert.equal((await dispatcher.dispatch('failed-'+i,'run_shell',JSON.stringify({command:'broken-'+i}))).ok,false);
 const repaired=await dispatcher.dispatch('corrected','run_shell',JSON.stringify({command:'corrected'}));
 assert(repaired.ok);assert.equal(calls,4);
});

test('structured snippet and unsupported-target outcomes are recoverable; transport failures retain the circuit',async()=>{
 assert.equal(isRecoverableToolFailure('execute_code',{ok:false,error:JSON.stringify({exit_code:1,timed_out:false,output_capped:false,stderr:'ValueError'})}),true);
 assert.equal(isRecoverableToolFailure('mcp_rea_open_binary',{ok:false,error:JSON.stringify({error:{code:'capability_unavailable',category:'unsupported_provider',retryable:false}})}),true);
 const registry=new ToolRegistry();let calls=0;
 registry.register({name:'remote_fixture',description:'transport fixture',parameters:{type:'object',properties:{}},requiresApproval:false,handler:async()=>{calls++;return{ok:false,error:'ECONNREFUSED: fixture backend unavailable'};}});
 const dispatcher=new ToolDispatcher(registry,new AgentEmitter());
 for(let i=0;i<4;i++)await dispatcher.dispatch('transport-'+i,'remote_fixture','{}');
 assert.equal(calls,3);
});
