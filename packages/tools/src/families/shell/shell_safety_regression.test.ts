import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRunShellTool } from './run_shell.js';
function fixture(t:any,run:(child:any)=>void){
 const child=Object.assign(new EventEmitter(),{pid:424242,stdout:new PassThrough(),stderr:new PassThrough(),kill(){this.emit('close',null);return true;},unref(){}});
 t.mock.method(childProcess,'spawn',()=>{queueMicrotask(()=>run(child));return child as any;});syncBuiltinESMExports();
 t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});return child;
}
test('shell capture and trace are bounded while retaining final diagnostics',async(t)=>{
 fixture(t,child=>{for(let i=0;i<30;i++)child.stdout.write('x'.repeat(65536));child.stdout.end('FINAL_MARKER');setImmediate(()=>child.emit('close',0));});
 let emitted=0;const tool=createRunShellTool({emit:(_type:string,data:any)=>{emitted+=data.delta?.length??0;}} as any);
 const result=await tool.handler({command:'synthetic-output'});assert.ok(result.ok);
 assert.ok(String(result.output).length<300_000);assert.ok(emitted<300_000);assert.match(String(result.output),/FINAL_MARKER/);
});
test('split UTF-8 shell output is decoded without replacement characters',async(t)=>{
 fixture(t,child=>{const bytes=Buffer.from('before 😀 after');child.stdout.write(bytes.subarray(0,9));child.stdout.end(bytes.subarray(9));setImmediate(()=>child.emit('close',0));});
 const result=await createRunShellTool({emit(){}} as any).handler({command:'synthetic-unicode'});assert.equal(result.output,'before 😀 after');
});
test('shell timeout terminates a process tree or isolated process group',async(t)=>{
 const child=fixture(t,()=>{});const killed:any[]=[];
 t.mock.method(childProcess,'execFile',(file:any,args:any,_options:any,done:any)=>{killed.push([file,args]);queueMicrotask(()=>{child.emit('close',null);done?.(null,'','');});return {} as any;});
 t.mock.method(process,'kill',(pid:any,signal:any)=>{killed.push([pid,signal]);queueMicrotask(()=>child.emit('close',null));return true;});syncBuiltinESMExports();
 const result=await createRunShellTool({emit(){}} as any).handler({command:'synthetic-hanging-tree',timeout_ms:1000});
 assert.equal(result.ok,false);
 if(process.platform==='win32')assert.ok(killed.some(([file,args])=>/taskkill/i.test(file)&&args.includes('/T')&&args.includes('424242')));
 else assert.ok(killed.some(([pid])=>pid===-424242));
});
