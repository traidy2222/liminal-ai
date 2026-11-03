import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./registry.js";
import { classifyLocalArtifactTask } from "./intent_inference.js";
import {
  requestedArtifactConnectors,
  missingArtifactConnectors,
} from "./artifact_connector_requirements.js";
function registry() {
  const r = new ToolRegistry();
  r.register({
    name: "mcp_rea_open_binary",
    description: "fixture",
    parameters: { type: "object", properties: {} },
    requiresApproval: false,
    handler: async () => ({ ok: true, output: "fixture" }),
  });
  r.setToolFamilyLookup(
    new Map([["mcp_rea_open_binary", "connector:rea:session"]]),
  );
  return r;
}

test('long artifact instructions retain requirements while documentation stays a writing task',()=>{
 const r=registry();
 const message='Inspect "C:/Games/disc.iso". '+ 'Keep the selected artifact unchanged. '.repeat(40)+' Use REA for static inspection.';
 assert.equal(classifyLocalArtifactTask(message),'execution');
 assert.deepEqual(requestedArtifactConnectors(message,r,classifyLocalArtifactTask(message)!==null),['rea']);
 for(const doc of ['Create a README explaining how to port game.iso using REA into a runnable exe.','Write a guide with the example "use REA on sample.exe".']){
  assert.equal(classifyLocalArtifactTask(doc),null);
  assert.deepEqual(requestedArtifactConnectors(doc,r,classifyLocalArtifactTask(doc)!==null),[]);
 }
});
test("grounded artifact tasks honor explicit registered provider requests", () => {
  const r = registry();
  for (const message of [
    "Inspect sample.exe using REA.",
    "Extract sample.iso for static REA inspection.",
    "Use REA to inspect sample.exe.",
  ])
    assert.deepEqual(requestedArtifactConnectors(message, r, true), ["rea"]);
  assert.deepEqual(
    missingArtifactConnectors(["rea"], ["mcp_search_tools"], r),
    ["rea"],
  );
  assert.deepEqual(
    missingArtifactConnectors(["rea"], ["mcp_rea_open_binary"], r),
    [],
  );
});
test("provider mentions, negatives, quoted instructions and unregistered providers do not force tool work", () => {
  const r = registry();
  assert.deepEqual(
    requestedArtifactConnectors(
      "Write documentation about using REA.",
      r,
      false,
    ),
    [],
  );
  assert.deepEqual(
    requestedArtifactConnectors("How does REA inspect sample.exe?", r, false),
    [],
  );
  for (const message of [
    "Inspect sample.exe without REA.",
    "Inspect sample.exe; do not use REA.",
    "Inspect sample.exe; avoid using REA.",
    'Inspect sample.exe and quote: "use REA to analyze it".',
    "Inspect sample.exe using UnknownEngine.",
  ])
    assert.deepEqual(requestedArtifactConnectors(message, r, true), []);
});
