import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import { resolvePythonWorkerProcess, spawnPythonWorker } from "./python_worker_process.js";

test("Windows speech workers use the real windowless interpreter with venv identity intact",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"liminal-python-worker-"));
  try{
    const venv=path.join(root,"speech env"),base=path.join(root,"base python");
    await fs.mkdir(path.join(venv,"Scripts"),{recursive:true});await fs.mkdir(base);
    const command=path.join(venv,"Scripts","python.exe");
    await fs.writeFile(path.join(venv,"pyvenv.cfg"),`home = ${base}\n`);
    await fs.writeFile(path.join(base,"python.exe"),"");await fs.writeFile(path.join(base,"pythonw.exe"),"");
    const launch=resolvePythonWorkerProcess(command,"win32");
    assert.equal(launch.command,path.join(base,"pythonw.exe"));
    assert.equal(launch.env?.__PYVENV_LAUNCHER__,command);
    assert.deepEqual(resolvePythonWorkerProcess(command,"linux"),{command});
    assert.deepEqual(resolvePythonWorkerProcess(process.execPath,"win32"),{command:process.execPath});
    await fs.unlink(path.join(base,"pythonw.exe"));
    assert.equal(resolvePythonWorkerProcess(command,"win32").command,path.join(base,"python.exe"));
    await fs.unlink(path.join(base,"python.exe"));assert.deepEqual(resolvePythonWorkerProcess(command,"win32"),{command});
  }finally{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});}
});

test("installed Windows ASR interpreter retains its packages and piped stdio without a redirector",{skip:process.platform!=="win32"||process.env.AGENT_LOCAL_PYTHON_INTEGRATION!=="1"},async()=>{
  const venv=path.join(os.homedir(),".liminal","transcription","whisper",".venv"),command=path.join(venv,"Scripts","python.exe");
  assert.ok(existsSync(command));
  const child=spawnPythonWorker(command,["-X","utf8","-u","-c","import sys,json; value=json.loads(sys.stdin.readline()); print(json.dumps({'prefix':sys.prefix,'executable':sys.executable,'value':value,'packages':[p for p in sys.path if 'site-packages' in p]}))"]);
  let out="",err="";child.stdout.on("data",d=>out+=d);child.stderr.on("data",d=>err+=d);
  child.stdin.end(JSON.stringify({text:"नमस्ते 世界"})+"\n");
  const code=await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("close",resolve);});
  assert.equal(code,0,err);const data=JSON.parse(out);
  assert.equal(path.normalize(data.prefix),path.normalize(venv));assert.equal(path.normalize(data.executable),path.normalize(command));
  assert.equal(data.value.text,"नमस्ते 世界");assert.ok(data.packages.some((p:string)=>p.startsWith(venv)));
});
