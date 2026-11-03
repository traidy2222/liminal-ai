import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {runWithWorkspaceRoot} from '@liminal/core';
import {RecursiveNameTableArchive} from './recursive_name_table.js';
import {inspectBinaryArchiveTool, extractArchiveFileTool} from './recursive_archive_tools.js';

type Node = {name: string; data?: Buffer; children?: Node[]};
function image(nodes: Node[]) {
  const chunks: Buffer[] = [Buffer.alloc(4)], files: Array<{meta: number; data: Buffer}> = [], records = new Map<string, number>();
  let at = 4;
  function append(bytes: Buffer) { chunks.push(bytes); at += bytes.length; }
  function visit(items: Node[], parent = '') {
    for (const item of items) {
      const name = Buffer.from(item.name, 'ascii'); if(item.children) name[0] = name[0]! | 128;
      append(name); append(Buffer.alloc(1)); if(at % 4) append(Buffer.alloc(4 - at % 4));
      const meta = at, full = parent ? `${parent}/${item.name}` : item.name; records.set(full, meta);
      const fields = Buffer.alloc(item.children ? 4 : 8); append(fields);
      if(item.children) { visit(item.children, full); fields.writeUInt32LE(at - meta, 0); }
      else files.push({meta, data: item.data ?? Buffer.alloc(0)});
    }
  }
  visit(nodes); const end = at, index = Buffer.concat(chunks); index.writeUInt32LE(end);
  let payloadEnd = Math.ceil(end / 2048) * 2048;
  const payloads: Array<{offset: number; data: Buffer}> = [];
  for(const file of files) {index.writeUInt32LE(file.data.length, file.meta);index.writeUInt32LE(payloadEnd,file.meta+4);payloads.push({offset:payloadEnd,data:file.data});payloadEnd=Math.ceil((payloadEnd+file.data.length)/2048)*2048;}
  const data = Buffer.alloc(Math.max(payloadEnd, Math.ceil(end/2048)*2048)); index.copy(data);
  for(const payload of payloads) payload.data.copy(data,payload.offset);
  return {data,indexEnd:end,records,payloads};
}
async function fixture(t: any, nodes: Node[]) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-recursive-archive-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert(path.basename(root).startsWith('liminal-recursive-archive-'));await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:20});});
  const built=image(nodes), file=path.join(root,'selected.dat');await fs.writeFile(file,built.data);return{root,file,...built};
}

test('mixed nested records use tagged names, absolute alignment and spans from the metadata word',async(t)=>{
  const f=await fixture(t,[{name:'build.txt',data:Buffer.from('build')},{name:'chars',children:[{name:'model.ucf',data:Buffer.from('model')},{name:'nested',children:[{name:'clip.bin',data:Buffer.from('clip')}]}]},{name:'other.bin',data:Buffer.from('other')}]);
  const archive=await RecursiveNameTableArchive.open(f.file);try{
    assert.deepEqual(archive.entries.map(entry=>[entry.path,entry.kind]),[['build.txt','file'],['chars','directory'],['chars/model.ucf','file'],['chars/nested','directory'],['chars/nested/clip.bin','file'],['other.bin','file']]);
    const folder=archive.entries[1]!;assert.equal(f.data[folder.record_offset],0xe3);assert.equal(folder.directory_end,folder.metadata_offset+f.data.readUInt32LE(folder.metadata_offset));
    assert.equal(archive.entries.at(-1)!.record_end,f.indexEnd);assert.equal(archive.bytesRead,f.indexEnd+4);
  }finally{await archive.close();}
});

test('every extent is checked and malformed layouts never return a partial inventory',async(t)=>{
  const f=await fixture(t,[{name:'dir',children:[{name:'a.bin',data:Buffer.from('a')},{name:'b.bin',data:Buffer.from('b')}]}]);
  const mutations=[
    (b:Buffer)=>b.writeUInt32LE(16*1024*1024+4,0),
    (b:Buffer)=>b.writeUInt32LE(0,f.records.get('dir')!),
    (b:Buffer)=>b.writeUInt32LE(0xfffffff0,f.records.get('dir')!),
    (b:Buffer)=>b.writeUInt32LE(f.data.length+1,f.records.get('dir/a.bin')!),
    (b:Buffer)=>b.writeUInt32LE(1,f.records.get('dir/a.bin')!+4),
    (b:Buffer)=>b.writeUInt32LE(f.data.readUInt32LE(f.records.get('dir/a.bin')!+4),f.records.get('dir/b.bin')!+4),
    (b:Buffer)=>b[f.records.get('dir/a.bin')!-2]=1,
  ];
  for(const change of mutations){const bytes=Buffer.from(f.data);change(bytes);await fs.writeFile(f.file,bytes);await assert.rejects(RecursiveNameTableArchive.open(f.file));}
});

test('traversal names and duplicate paths are refused',async(t)=>{
  for(const nodes of [[{name:'..',data:Buffer.from('x')}],[{name:'dir/file',data:Buffer.from('x')}],[{name:'same.bin'},{name:'same.bin'}]]){
    const f=await fixture(t,nodes);await assert.rejects(RecursiveNameTableArchive.open(f.file),/Unsafe|Duplicate/);
  }
});

test('depth and record-count resource limits are enforced',async(t)=>{
  let deep:Node={name:'file.bin',data:Buffer.from('x')};for(let i=0;i<33;i++)deep={name:'d',children:[deep]};
  const a=await fixture(t,[deep]);await assert.rejects(RecursiveNameTableArchive.open(a.file),/depth/);
  const b=await fixture(t,Array.from({length:50001},(_,i)=>({name:`f${i}.bin`})));await assert.rejects(RecursiveNameTableArchive.open(b.file),/record count/);
});

test('inspection retains a complete JSON inventory while its paginated response stays bounded',async(t)=>{
  const f=await fixture(t,Array.from({length:200},(_,i)=>({name:`${i}-`+'n'.repeat(190)+'.bin',data:Buffer.from('x')})));
  await runWithWorkspaceRoot(f.root,async()=>{
    const result=await inspectBinaryArchiveTool.handler({path:f.file,format:'recursive_name_table_v1',limit:200});assert(result.ok);assert(Buffer.byteLength(result.output)<=24000);
    const data=JSON.parse(result.output);assert.equal(data.record_count,200);assert(data.entries.length>0&&data.entries.length<200);assert.equal(data.next_offset,data.entries.length);
    const full=await fs.readFile(data.inventory_artifact.path,'utf8');assert.equal(createHash('sha256').update(full).digest('hex'),data.inventory_artifact.hash);assert.equal(JSON.parse(full).entries.length,200);
  });
});

test('source metadata/header inspection does not scan a sparse large payload',async(t)=>{
  const f=await fixture(t,[{name:'a.bin',data:Buffer.from('x')}]);const handle=await fs.open(f.file,'r+');await handle.truncate(128*1024*1024);await handle.close();
  const archive=await RecursiveNameTableArchive.open(f.file);try{assert(archive.bytesRead<128);}finally{await archive.close();}
});

test('source changes are detected before extraction can be accepted',async(t)=>{
  const f=await fixture(t,[{name:'a.bin',data:Buffer.from('x')}]);const archive=await RecursiveNameTableArchive.open(f.file);
  try{await fs.appendFile(f.file,Buffer.from([0]));await assert.rejects(archive.assertUnchanged(),/changed/);}finally{await archive.close();}
});

test('extraction hashes exact binary bytes, refuses overwrite and rejects destinations outside the workspace',async(t)=>{
  const bytes=Buffer.from([0xff,0xfe,0,0x80,0x23]);const f=await fixture(t,[{name:'dir',children:[{name:'a.bin',data:bytes}]}]);
  await runWithWorkspaceRoot(f.root,async()=>{
    const args={path:f.file,format:'recursive_name_table_v1',member_path:'dir/a.bin',destination:'out/selected.bin'};
    const result=await extractArchiveFileTool.handler(args);assert(result.ok);const data=JSON.parse(result.output);assert.equal(data.sha256,createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(await fs.readFile(data.destination),bytes);
    const again=await extractArchiveFileTool.handler(args);assert.equal(again.ok,false);assert.deepEqual(await fs.readFile(data.destination),bytes);
    const outside=await extractArchiveFileTool.handler({...args,destination:path.join(f.root,'../escape.bin')});assert.equal(outside.ok,false);
    const folder=await extractArchiveFileTool.handler({...args,member_path:'dir',destination:'out/folder.bin'});assert.equal(folder.ok,false);
  });
});

test('cancelling a streamed extraction removes only its own incomplete output',async(t)=>{
  const f=await fixture(t,[{name:'a.bin',data:Buffer.alloc(3*1024*1024,0x61)}]);const controller=new AbortController();
  const original=RecursiveNameTableArchive.prototype.read;RecursiveNameTableArchive.prototype.read=async function(offset,size){const bytes=await original.call(this,offset,size);if(offset>f.payloads[0]!.offset&&size>1024)controller.abort();return bytes;};
  t.after(()=>{RecursiveNameTableArchive.prototype.read=original;});
  await runWithWorkspaceRoot(f.root,async()=>{
    const result=await extractArchiveFileTool.handler({path:f.file,format:'recursive_name_table_v1',member_path:'a.bin',destination:'out/partial.bin'},undefined,undefined,{signal:controller.signal} as any);assert.equal(result.ok,false);
    await assert.rejects(fs.stat(path.join(f.root,'out/partial.bin')),/ENOENT/);assert.equal((await fs.stat(f.file)).size,f.data.length);
  });
});

test('unsupported profiles and linked extraction parents do not produce outputs',async(t)=>{
  const f=await fixture(t,[{name:'a.bin',data:Buffer.from('x')}]);
  await runWithWorkspaceRoot(f.root,async()=>{
    const bad=await inspectBinaryArchiveTool.handler({path:f.file,format:'guess'});assert.equal(bad.ok,false);
    const outside=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-recursive-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
    await fs.symlink(outside,path.join(f.root,'linked'),process.platform==='win32'?'junction':'dir');
    const result=await extractArchiveFileTool.handler({path:f.file,format:'recursive_name_table_v1',member_path:'a.bin',destination:'linked/escape.bin'});assert.equal(result.ok,false);await assert.rejects(fs.stat(path.join(outside,'escape.bin')),/ENOENT/);
  });
});
