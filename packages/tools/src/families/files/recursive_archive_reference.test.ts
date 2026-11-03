import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runWithWorkspaceRoot} from '@liminal/core';
import {RECURSIVE_ARCHIVE_PYTHON_REFERENCE} from './recursive_archive_reference.js';
import {inspectBinaryArchiveTool} from './recursive_archive_tools.js';
import {RecursiveNameTableArchive} from './recursive_name_table.js';

type Item = {name:string; children?:Item[]; bytes?:Buffer};
function fixtureBytes() {
  const parts:Buffer[]=[Buffer.alloc(4)], payloads:Array<{metadata:number;bytes:Buffer}>=[];
  let position=4;
  const append=(bytes:Buffer)=>{parts.push(bytes);position+=bytes.length;};
  function emit(items:Item[]){for(const item of items){const name=Buffer.from(item.name,'ascii');if(item.children)name[0]=name[0]!|128;append(name);append(Buffer.alloc(1));if(position%4)append(Buffer.alloc(4-position%4));const metadata=position,fields=Buffer.alloc(item.children?4:8);append(fields);if(item.children){emit(item.children);fields.writeUInt32LE(position-metadata);}else payloads.push({metadata,bytes:item.bytes??Buffer.alloc(0)});}}
  emit([{name:'root.bin',bytes:Buffer.from([0xff,0,0x80])},{name:'assets',children:[{name:'first.dat',bytes:Buffer.from('data')},{name:'nested',children:[{name:'clip.bin',bytes:Buffer.from('clip')}]}]},{name:'empty',children:[]}]);
  const index=Buffer.concat(parts);index.writeUInt32LE(position);const output=Buffer.alloc(8192);index.copy(output);
  let offset=2048;for(const payload of payloads){output.writeUInt32LE(payload.bytes.length,payload.metadata);output.writeUInt32LE(offset,payload.metadata+4);payload.bytes.copy(output,offset);offset+=2048;}
  return output;
}
function python() {
  for(const command of ['python','python3','py']){
    const version=spawnSync(command,['--version'],{encoding:'utf8',windowsHide:true,timeout:5000});
    if(version.status===0&&/^Python 3\./.test((version.stdout+version.stderr).trim()))return command;
  }
  throw new Error('Python3 is required to verify the emitted standalone reference parser');
}
async function setup(t:any){const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-reference-parser-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('liminal-reference-parser-'));await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:20});});const source=path.join(root,'different-name.data');await fs.writeFile(source,fixtureBytes());return{root,source,command:python()};}

test('the emitted standalone parser verifies the selected source and matches the TypeScript inventory',async(t)=>{
  const {root,source,command}=await setup(t);const before=await fs.readFile(source);
  await runWithWorkspaceRoot(root,async()=>{
    const inspected=await inspectBinaryArchiveTool.handler({path:source,format:'recursive_name_table_v1',limit:1});assert(inspected.ok);
    const result=JSON.parse(inspected.output),reference=result.reference_parser_artifact;
    assert.equal(reference.language,'python');assert.equal(reference.standalone,true);assert.deepEqual(reference.verify_command_args,[source,'--summary']);
    const emitted=await fs.readFile(reference.path,'utf8');assert.equal(emitted,RECURSIVE_ARCHIVE_PYTHON_REFERENCE);assert.equal(createHash('sha256').update(emitted).digest('hex'),reference.hash);
    const script=path.join(root,'user-chosen-parser.py');await fs.copyFile(reference.path,script);
    const summary=spawnSync(command,[script,...reference.verify_command_args],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:2*1024*1024});assert.equal(summary.status,0,summary.stderr);
    const compact=JSON.parse(summary.stdout);assert.equal(compact.record_count,result.record_count);assert.equal(compact.file_count,result.file_count);assert.equal(compact.directory_count,result.directory_count);assert.equal(compact.index_sha256,result.index_sha256);assert.equal(compact.entries,undefined);
    const complete=spawnSync(command,[script,source],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:2*1024*1024});assert.equal(complete.status,0,complete.stderr);
    const archive=await RecursiveNameTableArchive.open(source);try{assert.deepEqual(JSON.parse(complete.stdout).entries,archive.entries);}finally{await archive.close();}
    assert.deepEqual(await fs.readFile(source),before,'The reference must not alter selected source bytes');
  });
});

test('the reference rejects malformed indexes and requires an explicit source argument',async(t)=>{
  const {root,source,command}=await setup(t),script=path.join(root,'parser.py');await fs.writeFile(script,RECURSIVE_ARCHIVE_PYTHON_REFERENCE);
  const absent=spawnSync(command,[script,'--summary'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(absent.status,2);
  for(const corrupt of [(bytes:Buffer)=>bytes.writeUInt32LE(16*1024*1024+4),(bytes:Buffer)=>{const first=bytes.indexOf(Buffer.from([0xe1,0x73,0x73,0x65,0x74,0x73]));assert(first>=0);const end=bytes.indexOf(0,first);bytes.writeUInt32LE(0,Math.ceil((end+1)/4)*4);}]){
    const bytes=fixtureBytes();corrupt(bytes);await fs.writeFile(source,bytes);
    const failure=spawnSync(command,[script,source,'--summary'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(failure.status,1);assert.equal(failure.stdout,'');assert.match(failure.stderr,/recursive_name_table_v1:/);
    await assert.rejects(RecursiveNameTableArchive.open(source));
  }
});


test('path and descriptor timestamp conventions can differ without hiding actual source changes',async(t)=>{
 const {root,source,command}=await setup(t),script=path.join(root,'parser.py');await fs.writeFile(script,RECURSIVE_ARCHIVE_PYTHON_REFERENCE);
 const wrapper=String.raw`import json, os, runpy, sys, types
module=runpy.run_path(sys.argv[1])
real_stat, real_fstat=os.stat, os.fstat
path_calls=0
fd_calls=0
mode=sys.argv[3]
def project(value, **changes):
    fields={name:getattr(value,name) for name in ('st_mode','st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')}
    fields.update(changes)
    return types.SimpleNamespace(**fields)
def path_stat(*args, **kwargs):
    global path_calls
    path_calls+=1
    value=real_stat(*args, **kwargs)
    return project(value,st_ctime_ns=value.st_ctime_ns+100000+(1 if mode=='path-change' and path_calls>1 else 0),st_ino=value.st_ino+(1 if mode=='replacement' and path_calls>1 else 0))
def descriptor_stat(*args, **kwargs):
    global fd_calls
    fd_calls+=1
    value=real_fstat(*args, **kwargs)
    return project(value,st_ctime_ns=value.st_ctime_ns+(1 if mode=='descriptor-change' and fd_calls>1 else 0))
os.stat=path_stat
os.fstat=descriptor_stat
try:
    result=module['parse_archive'](sys.argv[2])
    print(json.dumps({'record_count':result['record_count']}))
except ValueError as error:
    print(str(error),file=sys.stderr)
    raise SystemExit(1)
`;
 const stable=spawnSync(command,['-c',wrapper,script,source,'stable'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(stable.status,0,stable.stderr);assert.equal(JSON.parse(stable.stdout).record_count,6);
 for(const mode of ['path-change','descriptor-change','replacement']){const changed=spawnSync(command,['-c',wrapper,script,source,mode],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(changed.status,1,mode);assert.match(changed.stderr,/Source changed/);}
});
