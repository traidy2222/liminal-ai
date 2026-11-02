import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runWithWorkspaceRoot } from '@liminal/core';
import { writeFileTool } from './write_file.js';
import { editFileTool } from './edit_file.js';
test('write and edit use identical locks for equivalent paths',()=>{
 runWithWorkspaceRoot(process.cwd(),()=>{
  const expected=writeFileTool.resourceLocks!({path:path.resolve('fixture.txt')});
  for(const tool of [writeFileTool,editFileTool])for(const p of ['fixture.txt','./fixture.txt','sub/../fixture.txt'])assert.deepEqual(tool.resourceLocks!({path:p}),expected);
 });
});
