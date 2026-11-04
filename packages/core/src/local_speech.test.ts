import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { LocalSpeechClient } from "./local_speech.js";
import { resolveSpeechSynthesisConfig, resolveSpeechSynthesisConfigAsync, synthesizeSpeechMulti, coerceTtsVoiceForModel } from "./speech_synthesis.js";
import { runHarnessEffectiveEnvContext } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

const worker = () => new LocalSpeechClient(process.execPath, [fileURLToPath(new URL("./fixtures/local_speech_worker.mjs", import.meta.url))]);
test("local speech serializes requests and reuses its warm process", async () => {
  const client=worker();
  try {
    const [a,b]=await Promise.all([client.synthesize("first",5000),client.synthesize("second",5000)]);
    assert.equal(Buffer.from(a).readUInt32LE(44),Buffer.from(b).readUInt32LE(44));
  } finally { client.close(); }
});
test("local speech timeout and cancellation release the worker and allow recovery", async () => {
  const client=worker();
  try {
    await assert.rejects(client.synthesize("hang",600),/timed out/);
    assert.equal(Buffer.from(await client.synthesize("recovered",5000)).toString("ascii",0,4),"RIFF");
    const abort=new AbortController();
    const pending=client.synthesize("hang",5000,abort.signal);
    setTimeout(()=>abort.abort(),100);
    await assert.rejects(pending,/cancelled/);
    assert.equal((await client.synthesize("again",5000)).length,48);
  } finally { client.close(); }
});
test("malformed worker output and worker crashes fail cleanly", async () => {
  const client=worker();
  try {
    await assert.rejects(client.synthesize("invalid",5000));
    await assert.rejects(client.synthesize("crash",5000),/stopped unexpectedly/);
    assert.equal((await client.synthesize("recovered",5000)).length,48);
  } finally { client.close(); }
});
test("a closed worker input pipe cannot crash the daemon", async () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  const client=new LocalSpeechClient(process.execPath,[fileURLToPath(new URL("./fixtures/local_speech_worker.mjs",import.meta.url))],(command,args)=>{
    child=spawn(command,args,{stdio:"pipe",windowsHide:true});return child;
  });
  try {
    await client.synthesize("ready",5000);
    const pending=client.synthesize("hang",5000);
    await new Promise<void>(resolve=>setImmediate(resolve));
    assert.ok(child);
    // Exercise the real Writable error event independently of OS-specific pipe-close races.
    child.stdin.destroy(Object.assign(new Error("write EPIPE"),{code:"EPIPE"}));
    await assert.rejects(pending,/EPIPE/);
    assert.equal((await client.synthesize("recovered",5000)).length,48);
  } finally { client.close(); }
});
test("explicit local speech works with one chat model, without cloud credentials or routing", async () => {
  const prefs: RuntimePreferences = {version:1,updatedAt:0,harness:{env:{AGENT_SINGLE_MODEL:"1",AGENT_TTS_ENABLED:"1",AGENT_TTS_MODEL:"local/jarvis-warm"}}};
  await runHarnessEffectiveEnvContext(prefs,async()=>{
    const config=resolveSpeechSynthesisConfig(prefs);
    assert.equal(config.enabled,true);
    assert.equal(config.voice,"jarvis-warm-v1");
    const mixedCase = resolveSpeechSynthesisConfig({...prefs,harness:{env:{...prefs.harness?.env,AGENT_TTS_MODEL:" LOCAL/JARVIS-WARM "}}});
    assert.equal(mixedCase.enabled,true);
    assert.equal(mixedCase.model,"local/jarvis-warm");
    const resolved=await resolveSpeechSynthesisConfigAsync(prefs);
    assert.equal(resolved.model,"local/jarvis-warm");
    assert.equal(coerceTtsVoiceForModel(config.model,"af_sky"),"jarvis-warm-v1");
    // Never fall back to cloud if the on-device runtime is missing.
    const previous=process.env["LIMINAL_LOCAL_VOICE_HOME"];
    const originalFetch=globalThis.fetch;
    process.env["LIMINAL_LOCAL_VOICE_HOME"]=fileURLToPath(new URL("./fixtures/no-voice-installed",import.meta.url));
    globalThis.fetch=async()=>{throw new Error("Unexpected network request");};
    try {
      await assert.rejects(synthesizeSpeechMulti({text:"Hello sir."},{...resolved,apiKey:""}),/Install the local voice first/);
      await assert.rejects(synthesizeSpeechMulti({text:"Keep this on device."},{...resolved,model:"local/unknown",apiKey:"never-send"}),/Unknown local speech model/);
      await assert.rejects(synthesizeSpeechMulti({text:"Keep this on device."},{...resolved,model:"local/gpt-4o-tts",apiKey:"never-send"}),/Unknown local speech model/);
      await assert.rejects(synthesizeSpeechMulti({text:"Keep this on device."},{...resolved,model:"LOCAL/gpt-4o-tts",apiKey:"never-send"}),/Unknown local speech model/);
    }
    finally {
      globalThis.fetch=originalFetch;
      if(previous===undefined)delete process.env["LIMINAL_LOCAL_VOICE_HOME"];else process.env["LIMINAL_LOCAL_VOICE_HOME"]=previous;
    }
  });
});
