import test from "node:test";
import assert from "node:assert/strict";
import {
  compactToolSequenceForPrime,
  formatRecipePrimeMessage,
  phaseShapeForTools,
  type RecipeEntry,
} from "./recipe_library.js";

test("phaseShapeForTools dedupes consecutive phases", () => {
  assert.deepEqual(
    phaseShapeForTools(["read_file", "grep_file", "write_file", "run_tests"]),
    ["LOCATE", "MUTATE", "VERIFY"]
  );
});

test("phaseShapeForTools builds stable recipe key shape", () => {
  const shape = phaseShapeForTools(["read_file", "write_file", "run_tests"]);
  const key = `coding::${shape.join("→")}`;
  assert.match(key, /^coding::LOCATE→MUTATE→VERIFY$/);
});

test("compactToolSequenceForPrime collapses repeated tools", () => {
  assert.equal(
    compactToolSequenceForPrime("grep_file → grep_file → grep_file → edit_file"),
    "grep_file ×3 → edit_file"
  );
});

test("formatRecipePrimeMessage is a one-line positive hint", () => {
  const entry: RecipeEntry = {
    key: "coding::LOCATE→MUTATE",
    intentClass: "coding",
    phaseShape: ["LOCATE", "MUTATE"],
    count: 4,
    outcomeSum: 2.8,
    outcomeCount: 4,
    toolUnion: ["grep_file", "edit_file"],
    bestExample: {
      toolSequence: "grep_file → grep_file → edit_file",
      outcome: 0.75,
      goal: "Fix a TypeScript symbol",
    },
    firstAt: "2026-01-01T00:00:00.000Z",
    lastAt: "2026-01-02T00:00:00.000Z",
  };
  const msg = formatRecipePrimeMessage(entry);
  assert.match(msg, /^\[RECIPE EVIDENCE\] Past tool execution:/);
  assert.match(msg, /grep_file ×2 → edit_file/);
  assert.match(msg, /reused ×4/);
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {formatRecipeLibraryHints,findBestRecipeForPrime} from "./recipe_library.js";
import {recipeStatsPaths} from "./global_storage.js";
test("irrelevant and cross-intent recipes never become plans",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"recipe-relevance-"));const prior=process.env.AGENT_GLOBAL_STORAGE_ROOT;
 process.env.AGENT_GLOBAL_STORAGE_ROOT=root;
 try{
 const recipe={key:"coding::LOCATE",intentClass:"coding",phaseShape:["LOCATE"],count:100,outcomeSum:100,outcomeCount:100,toolUnion:["read_file"],bestExample:{goal:"Repair TypeScript authentication parser",toolSequence:"read_file → edit_file",outcome:1},firstAt:"now",lastAt:"now"};
 await fs.writeFile(recipeStatsPaths().global,JSON.stringify({recipes:{fixture:recipe}}));
 assert.equal(await formatRecipeLibraryHints("Find the weather in Brisbane","knowledge"),null);
 assert.equal(await formatRecipeLibraryHints("Find the weather in Brisbane","coding"),null);
 assert.equal(await findBestRecipeForPrime("knowledge"),null);
 const hint=await formatRecipeLibraryHints("Repair TypeScript authentication parser","coding");assert.ok(hint);assert.match(hint,/process|Process/);assert.doesNotMatch(hint,/DEFAULT PLAN|plan skeleton|established play/);
 }finally{if(prior===undefined)delete process.env.AGENT_GLOBAL_STORAGE_ROOT;else process.env.AGENT_GLOBAL_STORAGE_ROOT=prior;await fs.rm(root,{recursive:true,force:true});}
});
