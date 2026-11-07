import {AsyncLocalStorage} from 'node:async_hooks';

const owner=new AsyncLocalStorage<string>();
const pending=new Map<string,Promise<void>>();
const active=new Set<string>();
export function browserTaskIsActive(taskId:string){return active.has(taskId);}
export function isCurrentBrowserTask(taskId:string){return owner.getStore()===taskId;}

/** Selected tabs are mutable chat state. Nested tool helpers share the same turn. */
export async function withBrowserTask<T>(taskId:string,action:()=>Promise<T>):Promise<T>{
 if(owner.getStore()===taskId)return action();
 const previous=pending.get(taskId)??Promise.resolve();
 const result=previous.then(()=>owner.run(taskId,async()=>{active.add(taskId);try{return await action();}finally{active.delete(taskId);}}));
 const tail=result.then(()=>undefined,()=>undefined);pending.set(taskId,tail);
 try{return await result;}finally{if(pending.get(taskId)===tail)pending.delete(taskId);}
}
