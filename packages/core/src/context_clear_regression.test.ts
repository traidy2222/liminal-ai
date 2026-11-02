import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextManager } from './context.js';
test('new conversation clears execution-state injection',()=>{
 const c=new ContextManager({modelMaxTokens:1000,systemPrompt:'test'} as any);
 c.setExecutionStateBlock('old mission');c.clear();assert.equal(c.getExecutionStateBlock(),'');
});
