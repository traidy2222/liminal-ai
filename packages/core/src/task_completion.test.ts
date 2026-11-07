import test from 'node:test';import assert from 'node:assert/strict';
import {TaskCompletionLedger} from './task_completion.js';
const request='Create these launch cards:\n• Research competing products\n• Define the launch message\n• Build the landing page\n• Prepare the product demo\n• Run the launch checklist\n• Publish the launch announcement';
test('explicit requested items cannot disappear in a shorter plan or a five-item completion claim',()=>{
 const ledger=new TaskCompletionLedger(request);
 const id=ledger.observe('browser_snapshot',true,'PAGE_CONTEXT: Research competing products; Define the launch message; Build the landing page; Prepare the product demo; Run the launch checklist')!;
 assert.equal(ledger.active,true);ledger.update({outcomes:request.split('\n').slice(1,6).map(s=>s.slice(2))});assert.equal(ledger.outcomes.length,6);
 for(const item of ledger.outcomes.slice(0,5))assert.equal(ledger.update({updates:[{id:item.id,status:'completed',evidence:[{observation_id:id,quote:item.description}]}]}).ok,true);
 assert.equal(ledger.pending[0]?.description,'Publish the launch announcement');assert.equal(ledger.needsReview,true);
 assert.equal(ledger.update({updates:[{id:'t6',status:'completed',evidence:[{observation_id:id,quote:'Run the launch checklist'}]}]}).ok,false);
 for(const subject of ['launch','announce','launch checklist']){
  assert.equal(ledger.update({updates:[{id:'t6',status:'completed',subject,evidence:[{observation_id:id,quote:'Run the launch checklist'}]}]}).ok,false);
 }
 const final=ledger.observe('browser_act',true,'PAGE_CONTEXT: Publish the launch announcement');
 assert.equal(ledger.update({updates:[{id:'t6',status:'completed',evidence:[{observation_id:final!,quote:'Publish the launch announcement'}]}]}).ok,true);assert.equal(ledger.needsReview,false);
});
test('ambiguous prose uses semantic outcomes, grounded updates are atomic and blockers stay incomplete',()=>{
 const ledger=new TaskCompletionLedger('Get the new launch workspace ready for next week and make it easy to see what is underway.');
 ledger.observe('browser_open',true,'PAGE_CONTEXT: Welcome');ledger.observe('browser_act',true,'ACTIONS_EXECUTED: 1');const id=ledger.observe('browser_snapshot',true,'PAGE_CONTEXT: Team launch workspace | Research complete | Landing page in progress');
 assert.equal(ledger.needsReview,true);assert.equal(ledger.update({outcomes:['Create launch workspace','Organize work by state']}).ok,true);
 assert.equal(ledger.update({updates:[{id:'t1',status:'completed',evidence:[{observation_id:id!,quote:'Team launch workspace'}]},{id:'t2',status:'completed',evidence:[{observation_id:'invented',quote:'Everything finished'}]}]}).ok,false);assert.equal(ledger.pending.length,2);
 assert.equal(ledger.update({updates:[{id:'t1',status:'completed',evidence:[{observation_id:id!,quote:'Team launch workspace'}]},{id:'t2',status:'blocked',reason:'Service requires a paid upgrade for this feature.'}]}).ok,true);
 assert.equal(ledger.needsReview,false);assert.equal(ledger.holdFinal,true);assert.match(ledger.handoff(),/incomplete.*Organize work by state.*paid upgrade/);
});
test('failures and typed field echoes cannot substantiate completion; simple page reads need no tracking',()=>{
 const ledger=new TaskCompletionLedger('Read the page');const id=ledger.observe('browser_open',true,'e1 textbox "Draft" value="Invented success"\nACTIONS_EXECUTED: 1');
 assert.equal(ledger.active,false);assert.equal(ledger.observe('browser_act',false,'Invented success'),undefined);
 ledger.update({outcomes:['Finish draft']});assert.equal(ledger.update({updates:[{id:'t1',status:'completed',evidence:[{observation_id:id!,quote:'Invented success'}]}]}).ok,false);
});

test('current rendered content in compact page deltas remains valid evidence',()=>{
 const ledger=new TaskCompletionLedger('Save the page checklist');const text='Due date Tuesday 5:00 PM\nDescription\nAcceptance checklist: clear headline and working signup';const id=ledger.observe('browser_act',true,'CONTENT_CHANGE: '+JSON.stringify({offset:10,text,previous_changed_to:50}));
 assert.equal(ledger.update({outcomes:['Save checklist and deadline'],updates:[{id:'t1',status:'completed',evidence:[{observation_id:id!,quote:'Due date Tuesday 5:00 PM Description Acceptance checklist: clear headline and working signup'}]}]}).ok,true);
});

test('the same plan contract supports ordinary tools without forcing a browser or exposing planning as evidence',()=>{
 const ledger=new TaskCompletionLedger('Fix the source file and run its focused tests');assert.equal(ledger.update({outcomes:['Save source change','Focused tests pass']}).ok,true);
 assert.equal(ledger.observe('plan',true,'Everything complete'),undefined);const saved=ledger.observe('edit_file',true,'Saved source change: src/app.ts');const tests=ledger.observe('run_tests',true,'Focused regression suite: 4 passed, 0 failed');
 assert.equal(ledger.update({updates:[{id:'t1',status:'completed',evidence:[{observation_id:saved!,quote:'Saved source change: src/app.ts'}]},{id:'t2',status:'completed',evidence:[{observation_id:tests!,quote:'4 passed, 0 failed'}]}]}).ok,true);assert.equal(ledger.needsReview,false);
});

test('continuation retains evidence identities and unrelated chats cannot reuse them',()=>{
 const first=new TaskCompletionLedger('Create an account');const proof=first.observe('browser_open',true,'PAGE_CONTEXT: Signed in as assistant');
 const follow=new TaskCompletionLedger('Finish the account record',{previous:first});assert.equal(follow.update({outcomes:['Account signed in'],updates:[{id:'t1',status:'completed',evidence:[{observation_id:proof!,quote:'Signed in as assistant'}]}]}).ok,true);
 const next=follow.observe('browser_snapshot',true,'PAGE_CONTEXT: Account recorded');assert.notEqual(proof,next);
 const unrelated=new TaskCompletionLedger('A different chat');unrelated.observe('browser_snapshot',true,'PAGE_CONTEXT: Different account');assert.equal(unrelated.update({outcomes:['Sign in'],updates:[{id:'t1',status:'completed',evidence:[{observation_id:proof!,quote:'Signed in as assistant'}]}]}).ok,false);
});

test('only a successful durable account receipt supplies account-memory evidence',()=>{
 const ledger=new TaskCompletionLedger('Save the account');assert.equal(ledger.observe('browser_credentials',true,JSON.stringify({login:{id:'prepared-only'}})),undefined);
 const id=ledger.observe('browser_credentials',true,JSON.stringify({account:{id:'account-id',loginMethod:'email_code'},evidence:'matched_current_page',available_in_new_chats:true}));
 assert.ok(id);assert.equal(ledger.update({outcomes:['Account available in later chats'],updates:[{id:'t1',status:'completed',evidence:[{observation_id:id!,quote:'"available_in_new_chats":true'}]}]}).ok,true);
});
