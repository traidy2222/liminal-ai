import test from 'node:test';
import assert from 'node:assert/strict';
import {withArtifactDiagnosticBudget, classifyLocalArtifactTask, isUnfamiliarArtifactInvestigation, tryHeuristicToolFirstTurn, applyTurnInferenceHeuristics, neutralTurnInferenceResult} from './intent_inference.js';

import {resolveReasoningBudget} from './reasoning_profile.js';

test('continuing a grounded archive investigation retains a diagnostic budget',()=>{
 const prompt='Continue local reverse engineering of assets at "C:/Games/archive.img". Read the actual archive/index structure, save a reusable parser and inventory, and extract a verified record. Write findings.json and findings.md.';
 assert.equal(classifyLocalArtifactTask(prompt),'execution');
 assert.equal(isUnfamiliarArtifactInvestigation(prompt),true);
 const routed=tryHeuristicToolFirstTurn(prompt)!;
 assert.equal(routed.thinkDepth,'standard');assert.equal(routed.reasoningWordBudget,400);assert.equal(routed.toolFirstBias,true);
 const prior=neutralTurnInferenceResult('fixture',{intent:'coding',reasoningEffort:'medium',thinkDepth:'brief',reasoningWordBudget:130,buildDeliverable:true,implementShip:true});
 const result=applyTurnInferenceHeuristics(prompt,prior);
 assert.equal(result.reasoningEffort,'medium');assert.equal(result.thinkDepth,'standard');assert.equal(result.reasoningWordBudget,400);
 assert.equal(result.complexity,prior.complexity);
});

test('ordinary extraction and conceptual/documentation questions retain their route',()=>{
 for(const prompt of ['Inspect C:/Games/disc.iso and extract its boot executable.','How does a parser infer the format of archive.img?','Write a guide explaining how to decode an unknown format in archive.img.']){
  assert.equal(isUnfamiliarArtifactInvestigation(prompt),false);
 }
 const ordinary=tryHeuristicToolFirstTurn('Inspect C:/Games/disc.iso and extract its boot executable.')!;
 assert.equal(ordinary.thinkDepth,'brief');assert.equal(ordinary.reasoningWordBudget,140);
});


test('the effective resolved fallback retains diagnostic depth without changing effort',()=>{
 const prompt='Continue local reverse engineering of "C:/Games/assets.img". Read the actual archive/index structure and save a reusable parser.';
 const routed=tryHeuristicToolFirstTurn(prompt)!;const fallback=resolveReasoningBudget(routed);
 const effective=withArtifactDiagnosticBudget(fallback,prompt);assert.equal(effective.thinkDepth,'standard');assert(effective.reasoningWordBudget>=400);assert.equal(effective.reasoningEffort,fallback.reasoningEffort);assert.equal(effective.source,fallback.source);
 assert.strictEqual(withArtifactDiagnosticBudget(fallback,'Inspect C:/Games/disc.iso and extract its boot executable.'),fallback);
});
