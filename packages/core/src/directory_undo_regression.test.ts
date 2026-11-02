import test from 'node:test';
import assert from 'node:assert/strict';
import { inferCompensationAction } from './compensation_ledger.js';
test('mkdir_p without creation provenance cannot infer file deletion',()=>{
 assert.equal(inferCompensationAction('mkdir_p',{path:'possibly-preexisting-directory'}),null);
});
