import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {useDictation} from './useDictation.ts';
import {setWebAuthToken} from '../webApiAuth.ts';

test('browser pause-send waits for final decode, recovers errors, and ignores an ended session upload', async () => {
  const dom = new JSDOM('<div id="root"></div>', {url: 'http://localhost'});
  const globals = ['window','document','navigator','Blob','FileReader','IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const originalFetch = globalThis.fetch;
  for(const key of globals) Object.defineProperty(globalThis,key,{value:key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key],configurable:true,writable:true});
  let level=0, recordings=0, decodes=0, dictation;
  const uploads=[], sent=[];
  class Recorder {
    static isTypeSupported(){return true;}
    state='inactive';mimeType='audio/webm';
    start(){this.state='recording';recordings++;}
    stop(){this.state='inactive';queueMicrotask(()=>{
      this.ondataavailable?.({data:new Blob([new Uint8Array(2000)],{type:this.mimeType})});
      this.onstop?.();
    });}
  }
  class AudioContext {
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
    createAnalyser(){return {fftSize:2048,connect(){},disconnect(){},getFloatTimeDomainData(buffer){buffer.fill(level);}};}
    createScriptProcessor(){return {connect(){},disconnect(){}};}
    close(){return Promise.resolve();}
  }
  Object.assign(dom.window,{MediaRecorder:Recorder,AudioContext});
  Object.defineProperty(dom.window.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{addEventListener(){},stop(){}}]})}});
  globalThis.MediaRecorder=Recorder;
  setWebAuthToken('fixture');
  globalThis.fetch=async(url)=>{
    if(String(url).includes('/api/audio/upload')) return new Promise(resolve=>uploads.push(resolve));
    if(String(url).includes('/api/transcribe')){
      decodes++;
      return new Response(JSON.stringify(decodes===2?{error:'Temporary decoder failure'}:{text:`final ${decodes}`,costUsd:0,model:'local/whisper-large-v3-turbo'}),{status:decodes===2?500:200});
    }
    throw Error('Unexpected request');
  };
  function Harness(){dictation=useDictation({onFinal:text=>sent.push(text),onAutoSend:text=>sent.push(text),endpoint:{minRecordingMs:100,silenceMsShort:100,silenceMsLong:100}});return null;}
  const root=createRoot(dom.window.document.getElementById('root'));
  const tick=async(ms=60)=>act(()=>new Promise(resolve=>setTimeout(resolve,ms)));
  const until=async(predicate)=>{for(let i=0;i<70&&!predicate();i++)await tick();assert.ok(predicate(),`state: ${dictation.state.status}`);};
  try{
    await act(async()=>root.render(React.createElement(Harness)));
    await act(()=>dictation.start());await tick(700);
    for(let i=1;i<=3;i++){
      level=.15;await until(()=>dictation.state.status==='recording');await tick(150);
      level=0;await until(()=>uploads.length===i);
      assert.equal(dictation.state.status,'uploading');
      level=.15;await tick(200);assert.equal(recordings,i,'no overlapping take while final decode is pending');level=0;
      await act(async()=>uploads[i-1](new Response(JSON.stringify({attachmentId:`clip-${i}`}))));
      await until(()=>dictation.state.status==='listening');
      assert.equal(dictation.state.sessionActive,true);
    }
    assert.deepEqual(sent,['final 1','final 3']);
    level=.15;await until(()=>dictation.state.status==='recording');await tick(150);level=0;
    await until(()=>uploads.length===4);
    await act(()=>dictation.endSession());await act(()=>dictation.start());
    await act(async()=>uploads[3](new Response(JSON.stringify({attachmentId:'stale'}))));await tick();
    assert.equal(decodes,3,'ended session must not enqueue a decode in the next session');
    assert.equal(dictation.state.status,'listening');
  }finally{
    await act(async()=>root.unmount());dom.window.close();globalThis.fetch=originalFetch;
    delete globalThis.MediaRecorder;setWebAuthToken(null);
    for(const [key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});
