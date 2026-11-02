import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextManager } from './context.js';
test('unchanged context reuses compression without losing the original UI transcript',async(t)=>{
 const previous=process.env.AGENT_CTX_PROVENANCE;process.env.AGENT_CTX_PROVENANCE='0';
 t.after(()=>{if(previous===undefined)delete process.env.AGENT_CTX_PROVENANCE;else process.env.AGENT_CTX_PROVENANCE=previous;});
 let calls=0;
 const ctx=new ContextManager({inceptionMessages:[{role:'system',content:'test'}],modelMaxTokens:100,thresholdFraction:0.1,keepRecentRounds:1,semanticSummarizer:async()=>{calls++;return 'A stable summary containing the important details.';}});
 for(let i=0;i<3;i++){
  ctx.append({role:'assistant',content:null,tool_calls:[{id:`c${i}`,type:'function',function:{name:'read_file',arguments:'{}'}}]});
  ctx.append({role:'tool',tool_call_id:`c${i}`,content:'large tool result '.repeat(100)});
 }
 const original=ctx.getConversationMessages();const first=await ctx.buildMessages();const second=await ctx.buildMessages();
 assert.equal(calls,1);assert.deepEqual(first,second);assert.deepEqual(ctx.getConversationMessages(),original);
 ctx.append({role:'user',content:'A new requirement'});await ctx.buildMessages();assert.equal(calls,2);
 ctx.clear();assert.deepEqual(ctx.getConversationMessages(),[]);
});
