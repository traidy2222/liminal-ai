import test from "node:test";
import assert from "node:assert/strict";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, writeFile, readdir, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createRouter } from "./routes.js";
import { tryHandleAudioRequest } from "../../sidecar/dist/audio_http.js";
import { LocalTranscriptionClient, closeLocalTranscription } from "../../core/dist/local_transcription.js";
import { wrapPcm16LeMonoAsWav } from "@liminal/core";

test("web and sidecar transcription routes propagate disconnects and clean up listeners",async t=>{
  for(const surface of ["web","sidecar"] as const){
    for(const cancel of [false,true]){
      await t.test(`${surface}: ${cancel?"client cancellation":"normal completion"}`,async st=>{
        const root=await mkdtemp(path.join(os.tmpdir(),"liminal-asr-route-"));
        const previousHome=process.env["LIMINAL_LOCAL_ASR_HOME"], previousStorage=process.env["AGENT_GLOBAL_STORAGE_ROOT"];
        process.env["LIMINAL_LOCAL_ASR_HOME"]=root;process.env["AGENT_GLOBAL_STORAGE_ROOT"]=path.join(root,"storage");
        const manifest=JSON.parse(await readFile(new URL("../../core/local-asr/manifest.json",import.meta.url),"utf8")) as {runtimeVersion:number;profiles:{whisper:{baseRevision:string}}};
        const python=path.join(root,"whisper",".venv",process.platform==="win32"?"Scripts/python.exe":"bin/python");
        await mkdir(path.dirname(python),{recursive:true});await writeFile(python,"");
        await writeFile(path.join(root,"whisper","ready.json"),JSON.stringify({runtimeVersion:manifest.runtimeVersion,revision:manifest.profiles.whisper.baseRevision,cuda:false}));
        let began!:()=>void;const started=new Promise<void>(resolve=>{began=resolve;});
        let receivedSignal:AbortSignal|undefined;
        // Exercise the real HTTP adapters and speech routing, replacing only the costly decoder.
        st.mock.method(LocalTranscriptionClient.prototype,"transcribe",async (payload:Record<string,unknown>,_timeout:number,signal?:AbortSignal)=>{
          receivedSignal=signal;assert.ok(signal);assert.equal(payload.language,"hi");began();
          if(cancel)return new Promise<{text:string;noSpeech:boolean;durationSec:number}>((_resolve,reject)=>signal.addEventListener("abort",()=>reject(new Error("cancelled")),{once:true}));
          return {text:"नमस्ते",language:"hi",noSpeech:false,durationSec:1};
        });
        const prefs={version:1 as const,updatedAt:0,harness:{env:{AGENT_SINGLE_MODEL:"1",AGENT_TRANSCRIBE_ENABLED:"1",AGENT_TRANSCRIBE_MODEL:"local/whisper-large-v3-turbo",AGENT_TRANSCRIBE_LANGUAGE:"hi"}}};
        const bridge={chatId:"route-test",harness:{getRuntimePreferences:()=>prefs}};
        let captured:{req:IncomingMessage;res:ServerResponse;reqCount:number;resCount:number}|undefined;
        const record=(req:IncomingMessage,res:ServerResponse)=>{captured={req,res,reqCount:req.listenerCount("aborted"),resCount:res.listenerCount("close")};};
        let server:http.Server;
        if(surface==="web"){
          const app=express();app.use(express.json());app.use((req,res,next)=>{record(req,res);next();});
          app.use(createRouter({getActive:()=>bridge} as unknown as Parameters<typeof createRouter>[0],{} as Parameters<typeof createRouter>[1],{token:"test"} as Parameters<typeof createRouter>[2]));
          server=http.createServer(app);
        }else{
          server=http.createServer((req,res)=>{record(req,res);if(!tryHandleAudioRequest(req,res,{token:"test",resolveBridge:()=>bridge as never})){res.writeHead(404);res.end();}});
        }
        try{
          await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
          const address=server.address();assert.ok(address&&typeof address!=="string");
          const controller=new AbortController();
          const request=fetch(`http://127.0.0.1:${address.port}/api/transcribe?token=test`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({previewWav:Buffer.from(wrapPcm16LeMonoAsWav(new Uint8Array([0,0]),16000)).toString("base64")}),signal:controller.signal});
          await started;
          if(cancel){controller.abort();await assert.rejects(request,/abort/i);}
          else{const response=await request;assert.equal(response.status,200);assert.equal((await response.json() as {costUsd:number}).costUsd,0);}
          for(let i=0;i<100;i++){
            if(captured&&captured.req.listenerCount("aborted")===captured.reqCount&&captured.res.listenerCount("close")===captured.resCount)break;
            await new Promise(resolve=>setTimeout(resolve,5));
          }
          assert.ok(captured);assert.equal(receivedSignal?.aborted,cancel);
          assert.equal(captured.req.listenerCount("aborted"),captured.reqCount);
          assert.equal(captured.res.listenerCount("close"),captured.resCount);
          if(cancel)assert.deepEqual(await readdir(path.join(root,"storage/chats/route-test/audio")).catch(()=>[]),[]);
        }finally{
          closeLocalTranscription();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
          if(previousHome===undefined)delete process.env["LIMINAL_LOCAL_ASR_HOME"];else process.env["LIMINAL_LOCAL_ASR_HOME"]=previousHome;
          if(previousStorage===undefined)delete process.env["AGENT_GLOBAL_STORAGE_ROOT"];else process.env["AGENT_GLOBAL_STORAGE_ROOT"]=previousStorage;
          await rm(root,{recursive:true,force:true});
        }
      });
    }
  }
});
