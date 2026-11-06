import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runWithWorkspaceRoot } from "@liminal/core";
import { editFileTool } from "./edit_file.js";

test("sequential edits reuse returned versions; intervening writes reject without losing content",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"liminal-file-version-"));
 try { await runWithWorkspaceRoot(root,async()=>{
  const file=path.join(root,"fixture.txt");await fs.writeFile(file,"first\nsecond\n");
  const first=await editFileTool.handler({path:file,replacements:[{search:"first",replace:"one"}]});assert.ok(first.ok);
  const hash=first.output.match(/SHA256: ([a-f0-9]{64})/)?.[1];assert.ok(hash);
  const second=await editFileTool.handler({path:file,expected_sha256:hash,replacements:[{search:"one",replace:"ONE"}]});assert.ok(second.ok);
  const currentHash=second.output.match(/SHA256: ([a-f0-9]{64})/)?.[1];assert.ok(currentHash);
  await fs.writeFile(file,"external update\n");
  const conflict=await editFileTool.handler({path:file,expected_sha256:currentHash,insert_at:{line:1,content:"must not insert"}});
  assert.equal(conflict.ok,false);assert.equal(await fs.readFile(file,"utf8"),"external update\n");
 }); } finally { await fs.rm(root,{recursive:true,force:true}); }
});
