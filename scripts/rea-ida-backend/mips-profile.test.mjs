import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {verifiedPs2MipsElfTarget} from './mips-profile.mjs';

function header(){const b=Buffer.alloc(84);Buffer.from([0x7f,0x45,0x4c,0x46,1,1,1]).copy(b);b.writeUInt16LE(2,16);b.writeUInt16LE(8,18);b.writeUInt32LE(1,20);b.writeUInt32LE(0x100008,24);b.writeUInt32LE(52,28);b.writeUInt32LE(0x20924001,36);b.writeUInt16LE(52,40);b.writeUInt16LE(32,42);b.writeUInt16LE(1,44);return b;}
test('only the verified static ELF32LE MIPS profile is admitted',async(t)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'liminal-mips-profile-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
 const file=path.join(root,'sample.elf');const target={kind:'executable',format:'elf',architecture:'mips',path:file};
 await fs.writeFile(file,header());assert.equal(verifiedPs2MipsElfTarget(target),true);
 for(const change of [b=>b[4]=2,b=>b[5]=2,b=>b.writeUInt16LE(1,16),b=>b.writeUInt16LE(62,18),b=>b.writeUInt32LE(0,36),b=>b.writeUInt32LE(0x100009,24),b=>b.writeUInt32LE(1024,28),b=>b.writeUInt16LE(0,44)]){const b=header();change(b);await fs.writeFile(file,b);assert.equal(verifiedPs2MipsElfTarget(target),false);}
 await fs.writeFile(file,header().subarray(0,51));assert.equal(verifiedPs2MipsElfTarget(target),false);
 await fs.writeFile(file,header());assert.equal(verifiedPs2MipsElfTarget({...target,architecture:'x86'}),false);assert.equal(verifiedPs2MipsElfTarget({...target,path:root}),false);
});
