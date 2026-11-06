import test from "node:test";
import assert from "node:assert/strict";
import {buildResearchTurnInjection} from "./research_depth.js";
test("research guidance uses evidence gaps and requested format",()=>{
 const text=buildResearchTurnInjection({userMessage:"research this"});
 assert.match(text,/stop when material claims are supported/);assert.match(text,/requested answer format/);
 assert.doesNotMatch(text,/Bedrock|Mosaic|T1|before synthesizing|several web_search/);
});
