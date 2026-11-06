import test from "node:test";
import assert from "node:assert/strict";
import {needsResearchContinuation,researchCoverageLooksThin} from "./research_continuation.js";
const summary={searchCount:1,uniqueQueryCount:1,urlInventoryCount:50,fetchedOk:1,fetchedFail:0,pending:49};
test("many pending URLs do not prove coverage is thin",()=>assert.equal(researchCoverageLooksThin(summary),false));
test("a short supported reply is allowed to finish",()=>{
 const result=needsResearchContinuation({userMessage:"Current version?",intent:"research",toolsUsed:["web_fetch"],summary,gateAttempted:false,assistantText:"Version 3.2, per the official release page."});
 assert.equal(result.needed,false);
});
test("empty web result gets one answer recovery without a fetch quota",()=>{
 const input={userMessage:"research this",toolsUsed:["web_fetch"],summary,gateAttempted:false};
 const result=needsResearchContinuation(input);assert.ok(result.needed);
 if(result.needed){assert.match(result.message,/evidence already obtained/);assert.doesNotMatch(result.message,/parallel|research_state|T1|not finalize/);}
 assert.equal(needsResearchContinuation({...input,gateAttempted:true}).needed,false);
});
