import test from 'node:test';
import assert from 'node:assert/strict';
import { getCompensationLedger, recordCompensation, createDefaultExecutionState, advanceExecutionStateForPlan } from './execution_state.js';
test('identical plan IDs in different harness owners cannot share undo actions',()=>{
 const a={},b={};
 try{
  (recordCompensation as any)('same-plan',0,{kind:'delete_file',path:'synthetic.txt'},a);
  assert.equal((getCompensationLedger as any)(b).entriesForPlan('same-plan').length,0);
  assert.equal((getCompensationLedger as any)(a).entriesForPlan('same-plan').length,1);
 }finally{getCompensationLedger().clearAll();}
});
test('plans created in the same clock tick receive distinct contract IDs',(t)=>{
 t.mock.method(Date,'now',()=>123456);
 const a=createDefaultExecutionState('a'),b=createDefaultExecutionState('b');assert.notEqual(a.mission?.id,b.mission?.id);
 const first=advanceExecutionStateForPlan(a,['step']),second=advanceExecutionStateForPlan(a,['replacement']);
 assert.notEqual(first.activeContractId,second.activeContractId);
});
