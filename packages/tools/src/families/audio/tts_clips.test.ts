import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveTtsClip, readTtsClip } from "./tts_clips.js";

test("switching speech model or voice never reuses the old voice clip", async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"liminal-voice-cache-"));
  const previous=process.env["AGENT_GLOBAL_STORAGE_ROOT"];
  process.env["AGENT_GLOBAL_STORAGE_ROOT"]=root;
  try {
    const text="Good evening sir.";
    const old=await saveTtsClip("voice-test",Buffer.from("old voice"),"audio/mpeg",text,"cloud:kokoro:af_sky");
    const warm=await saveTtsClip("voice-test",Buffer.from("warm voice"),"audio/mpeg",text,"local:jarvis:jarvis-warm-v1");
    assert.notEqual(old.clipId,warm.clipId);
    assert.equal(warm.cacheHit,false);
    const repeated=await saveTtsClip("voice-test",Buffer.from("warm voice"),"audio/mpeg",text,"local:jarvis:jarvis-warm-v1");
    assert.equal(repeated.clipId,warm.clipId);assert.equal(repeated.cacheHit,true);
    assert.equal((await readTtsClip("voice-test",old.clipId))?.bytes.toString(),"old voice");
  } finally {
    if(previous===undefined)delete process.env["AGENT_GLOBAL_STORAGE_ROOT"];else process.env["AGENT_GLOBAL_STORAGE_ROOT"]=previous;
    await rm(root,{recursive:true,force:true});
  }
});
