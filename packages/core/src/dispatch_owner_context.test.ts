import test from "node:test";
import assert from "node:assert/strict";
import {AgentHarness} from "./agent.js";
import {ToolDispatcher} from "./dispatcher.js";
import type {ToolDefinition} from "./types.js";
test("each harness supplies its own task context for dispatch and direct calls",async()=>{
 const tool:ToolDefinition={name:"owner_fixture",description:"owner",parameters:{type:"object",properties:{}},requiresApproval:false,handler:async(_args,_emit,owner)=>({ok:true,output:owner?.taskId??"missing"})};
 for(const taskId of ["first-agent","second-agent"]){
 const h=new AgentHarness({taskId,openRouterApiKey:"synthetic",baseURL:"http://127.0.0.1:1",model:"fixture",maxToolRoundsPerTurn:1,worldContext:{disabled:true},context:{inceptionMessages:[],modelMaxTokens:100000}});h.registry.register(tool);
 const dispatcher=(h as unknown as {dispatcher:ToolDispatcher}).dispatcher;
 const regular=await dispatcher.dispatch("owner-call","owner_fixture","{}");assert.ok(regular.ok);assert.equal(regular.output,taskId);
 const direct=await dispatcher.directCall("owner_fixture",{});assert.ok(direct.ok);assert.equal(direct.output,taskId);
 }
});
