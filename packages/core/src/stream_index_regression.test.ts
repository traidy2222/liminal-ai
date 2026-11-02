import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamAccumulator } from './streaming.js';
test('missing provider indices preserve parallel call identity',()=>{
 const acc=new StreamAccumulator();
 acc.processChunk({choices:[{delta:{tool_calls:[{id:'a',function:{name:'one',arguments:'{"a":'}},{id:'b',function:{name:'two',arguments:'{"b":'}}]}}]} as any);
 acc.processChunk({choices:[{delta:{tool_calls:[{id:'b',function:{arguments:'2}'}},{id:'a',function:{arguments:'1}'}}]}}]} as any);
 assert.deepEqual(acc.accumulatedToolCalls,[{id:'a',name:'one',argsJson:'{"a":1}'},{id:'b',name:'two',argsJson:'{"b":2}'}]);
});
