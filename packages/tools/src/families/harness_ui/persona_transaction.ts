import {AsyncLocalStorage} from 'node:async_hooks';
import {existsSync,renameSync} from 'node:fs';
import {mkdir,mkdtemp,rename,rm,cp} from 'node:fs/promises';
import path from 'node:path';

const context=new AsyncLocalStorage<{dir:string;signal:AbortSignal}>();
let pending=Promise.resolve();
export function personaStagingDirectory(){return context.getStore()?.dir;}
export function personaGenerationSignal(){return context.getStore()?.signal;}
export function checkPersonaCancellation(){context.getStore()?.signal.throwIfAborted();}
export function recoverPersonaPromotion(dir:string){const backup=dir+'.previous';if(!existsSync(dir)&&existsSync(backup))renameSync(backup,dir);}

/** Publish a complete directory only after generation succeeds; failed drafts never replace active files. */
export async function personaTransaction<T>(dir:string,action:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
 if(context.getStore())return action();
 const previous=pending;let release!:()=>void;pending=new Promise<void>(r=>{release=r;});
 await previous;let stage='';
 const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(240000)]):AbortSignal.timeout(240000);
 try{
  combined.throwIfAborted();recoverPersonaPromotion(dir);await mkdir(path.dirname(dir),{recursive:true});stage=await mkdtemp(path.join(path.dirname(dir),'.persona-staging-'));
  if(existsSync(path.join(dir,'soul','living.md'))){await mkdir(path.join(stage,'soul'));await cp(path.join(dir,'soul','living.md'),path.join(stage,'soul','living.md'));}
  const result=await context.run({dir:stage,signal:combined},action);combined.throwIfAborted();
  if(!existsSync(path.join(stage,'runtime_profile.json'))||!existsSync(path.join(stage,'manifest.json')))throw Error('Persona generation did not produce a complete profile. Retry or use the built-in personality.');
  const backup=dir+'.previous';await rm(backup,{recursive:true,force:true});const hadActive=existsSync(dir);
  if(hadActive)await rename(dir,backup);
  try{await rename(stage,dir);stage='';}catch(error){if(hadActive)await rename(backup,dir);throw error;}
  await rm(backup,{recursive:true,force:true}).catch(()=>{});return result;
 }finally{if(stage)await rm(stage,{recursive:true,force:true}).catch(()=>{});release();}
}
