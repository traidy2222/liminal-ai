import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentHarness } from './agent.js';
import { createDefaultExecutionState, advanceExecutionStateForPlan } from './execution_state.js';

function fixture() {
  const harness = new AgentHarness({openRouterApiKey:'synthetic-test-key',baseURL:'http://127.0.0.1:1',model:'fixture',maxToolRoundsPerTurn:60,
    worldContext:{disabled:true},context:{inceptionMessages:[],modelMaxTokens:1000000,thresholdFraction:0.9}});
  const agent = harness as any;
  agent.executionState = createDefaultExecutionState('Extract the selected model, skeleton and animations');
  agent.sendStartTime = Date.now();
  agent.lastUserMessage = 'Inspect the selected local artifact';
  agent.prepareMessagesForContextLimit = async (messages: unknown) => messages;
  return {harness,agent};
}

test('successful work continues beyond round 40 without a fabricated recovery plan', async () => {
  const previous={...process.env};
  Object.assign(process.env,{AGENT_RULE_RECALL:'0',AGENT_TRAJECTORY_WRITE:'0',AGENT_CRITIC:'0',AGENT_YIELD_EVERY_N:'0',AGENT_MEMORY_PRIME_ROUND0:'0'});
  const {harness,agent}=fixture();let executed=0;let streams=0;
  harness.registry.register({name:'inspect_fixture',description:'inspect',parameters:{type:'object',properties:{}},handler:async()=>{executed++;return{ok:true,output:'Verified fixture record '+executed};}});
  harness.registry.activate(['inspect_fixture']);
  agent.streamWithRetry=async()=> (async function*(){
    const n=++streams;
    yield {choices:[{index:0,delta:n<=45?{tool_calls:[{index:0,id:'call-'+n,type:'function',function:{name:'inspect_fixture',arguments:'{}'}}]}:{content:'Inspection complete.'},finish_reason:n<=45?'tool_calls':'stop'}]};
  })();
  try{await agent.runReActLoop();assert.equal(executed,45);assert.deepEqual(harness.getExecutionState()?.contracts,[]);}
  finally{process.env=previous;}
});

test('a plan created late in a turn gets its own budget and still enforces it', () => {
  const {agent}=fixture();agent.roundCount=40;agent.toolCallsDispatchedThisSend=100;
  agent.executionState=advanceExecutionStateForPlan(agent.executionState,['Inspect archive','Extract model']);
  assert.equal(agent.checkContractBudgetExceeded(),null,'earlier work does not consume a newly started contract');
  agent.toolCallsDispatchedThisSend+=13;
  assert.match(agent.checkContractBudgetExceeded()??'',/Tool call budget/);
});

test('a real contract stop leaves a visible incomplete-work handoff', async () => {
  const {harness,agent}=fixture();let visible='';
  harness.emitter.on('text',e=>{if(!e.channel||e.channel==='user')visible+=e.delta;});
  agent.executionState=advanceExecutionStateForPlan(agent.executionState,['Inspect archive']);
  agent.executionState.contracts[0].maxSteps=0;
  await agent.runReActLoop();
  assert.match(visible,/paused|budget/i);assert.match(harness.getContext().getLastAssistantMessage()??'',/pending|incomplete|not complete/i);
});
