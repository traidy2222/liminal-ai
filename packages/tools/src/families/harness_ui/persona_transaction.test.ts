import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {personaTransaction,personaStagingDirectory,recoverPersonaPromotion} from './persona_transaction.js';
test('persona staging preserves active files on failure/cancellation and publishes only complete artifacts',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'liminal-persona-transaction-')),active=path.join(root,'active');await mkdir(active);await writeFile(path.join(active,'runtime_profile.json'),'old');
 const draft=async()=>{const dir=personaStagingDirectory()!;await writeFile(path.join(dir,'runtime_profile.json'),'new');await writeFile(path.join(dir,'manifest.json'),'{}');};
 try{
  await assert.rejects(personaTransaction(active,async()=>{await draft();throw Error('provider failed');}),/provider failed/);assert.equal(await readFile(path.join(active,'runtime_profile.json'),'utf8'),'old');
  const cancellation=new AbortController();await assert.rejects(personaTransaction(active,async()=>{await draft();cancellation.abort();},cancellation.signal));assert.equal(await readFile(path.join(active,'runtime_profile.json'),'utf8'),'old');
  await personaTransaction(active,draft);assert.equal(await readFile(path.join(active,'runtime_profile.json'),'utf8'),'new');
  await rename(active,active+'.previous');recoverPersonaPromotion(active);assert.equal(await readFile(path.join(active,'runtime_profile.json'),'utf8'),'new');
 }finally{await rm(root,{recursive:true,force:true});}
});
