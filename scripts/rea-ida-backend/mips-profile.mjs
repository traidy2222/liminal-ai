import {openSync, readSync, closeSync, fstatSync, constants} from 'node:fs';

/** Static profile verified on the two supplied PS2 executables. Other MIPS
 * classes, endian variants, relocatables and ABI flags remain unsupported.
 * IDA's own loader/decompiler/license checks still determine availability.
 */
export function verifiedPs2MipsElfTarget(target) {
  if (target?.kind !== 'executable' || target.format !== 'elf' || target.architecture !== 'mips' || typeof target.path !== 'string') return false;
  let fd;
  try {
    fd=openSync(target.path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    const stat=fstatSync(fd);if(!stat.isFile()||stat.size<52)return false;
    const bytes=Buffer.alloc(52);let done=0;
    while(done<bytes.length){const count=readSync(fd,bytes,done,bytes.length-done,done);if(!count)return false;done+=count;}
    if(!bytes.subarray(0,7).equals(Buffer.from([0x7f,0x45,0x4c,0x46,1,1,1])))return false;
    if(bytes.readUInt16LE(16)!==2||bytes.readUInt16LE(18)!==8||bytes.readUInt32LE(20)!==1)return false;
    // The observed R5900/EABI32 flags are intentionally exact: this repair does
    // not declare every MIPS ABI/ISA supported based on one successful target.
    if(bytes.readUInt32LE(36)!==0x20924001||bytes.readUInt16LE(40)!==52)return false;
    const entry=bytes.readUInt32LE(24),offset=bytes.readUInt32LE(28),width=bytes.readUInt16LE(42),count=bytes.readUInt16LE(44);
    return entry!==0&&entry%4===0&&offset>=52&&width>=32&&count>0&&count<=4096&&offset+width*count<=stat.size;
  } catch {return false;}
  finally {if(fd!==undefined)closeSync(fd);}
}
