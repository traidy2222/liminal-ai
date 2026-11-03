import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileMetadataTool } from "./file_metadata.js";
import { readBinaryTool } from "./read_binary.js";
import { observeDiscFileHeader } from "./iso9660.js";

test("metadata, binary reads and disc members agree on a nonzero PT_LOAD file offset", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "liminal-native-header-"));
  const file = path.join(root, "boot.elf"), size = 0x300000, entryOffset = 0x15c718;
  const header = Buffer.alloc(84); Buffer.from([0x7f,0x45,0x4c,0x46,1,1,1]).copy(header);
  header.writeUInt16LE(2,16); header.writeUInt16LE(8,18); header.writeUInt32LE(1,20);
  header.writeUInt32LE(0x25b718,24); header.writeUInt32LE(52,28); header.writeUInt16LE(52,40); header.writeUInt16LE(32,42); header.writeUInt16LE(1,44);
  header.writeUInt32LE(1,52); header.writeUInt32LE(0x1000,56); header.writeUInt32LE(0x100000,60); header.writeUInt32LE(0x200000,68); header.writeUInt32LE(0x200000,72);
  const entry = Buffer.from("280c007028140070281c007028240070", "hex");
  try {
    const handle = await fs.open(file, "wx");
    try { await handle.truncate(size); await handle.write(header,0,header.length,0); await handle.write(entry,0,entry.length,entryOffset); }
    finally { await handle.close(); }
    const metadata = await fileMetadataTool.handler({ path: file, include_hash: false }); assert(metadata.ok);
    const observed = JSON.parse(metadata.output);
    assert.equal(observed.native_header.entry.file_offset, entryOffset);
    assert.deepEqual(observed.mapped_entry_bytes.hex, entry.toString("hex")); assert.equal(observed.mapped_entry_bytes.length,16);
    assert.equal(observed.sha256, undefined);
    const binary = await readBinaryTool.handler({ path: file, length: 256 }); assert(binary.ok);
    const result = JSON.parse(binary.output);
    assert.equal(result.native_header_observation.entry.file_offset,entryOffset);
    const disc = observeDiscFileHeader(header, size) as any;
    assert.equal(disc.entry,"0x25b718", "preserve old disc observation fields");
    assert.equal(disc.native_header.entry.file_offset,entryOffset);
    const window = await readBinaryTool.handler({ path: file, offset: entryOffset, length:16 }); assert(window.ok);
    const bytes = JSON.parse(window.output);
    assert.equal(bytes.native_header_observation, undefined);
    assert.equal(bytes.rows[0].hex.replaceAll(" ",""),entry.toString("hex"));
  } finally {
    assert.equal(path.dirname(root),path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("liminal-native-header-"));
    await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:20});
  }
});
