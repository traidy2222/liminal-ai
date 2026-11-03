import test from "node:test";
import assert from "node:assert/strict";
import { observeNativeBinaryHeader } from "./native_binary_header.js";

export function elfFixture(big = false, segments = 1): Buffer {
  const bytes = Buffer.alloc(52 + segments * 32);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, big ? 2 : 1, 1]).copy(bytes);
  const u16 = (value: number, p: number) => big ? bytes.writeUInt16BE(value, p) : bytes.writeUInt16LE(value, p);
  const u32 = (value: number, p: number) => big ? bytes.writeUInt32BE(value, p) : bytes.writeUInt32LE(value, p);
  u16(2, 16); u16(8, 18); u32(1, 20); u32(0x25b718, 24); u32(52, 28); u16(52, 40); u16(32, 42); u16(segments, 44);
  for (let i = 0; i < segments; i++) {
    const p = 52 + i * 32;
    u32(1, p); u32(0x1000, p + 4); u32(0x100000, p + 8); u32(0x200000, p + 16); u32(0x200000, p + 20);
  }
  return bytes;
}

function peFixture(plus = false, sections = 1): Buffer {
  const bytes = Buffer.alloc(1024), pe = 0x80, optional = pe + 24, size = plus ? 240 : 224;
  bytes.write("MZ"); bytes.writeUInt32LE(pe, 60); bytes.write("PE\0\0", pe);
  bytes.writeUInt16LE(plus ? 0x8664 : 0x14c, pe + 4); bytes.writeUInt16LE(sections, pe + 6); bytes.writeUInt16LE(size, pe + 20);
  bytes.writeUInt16LE(plus ? 0x20b : 0x10b, optional); bytes.writeUInt32LE(0x1120, optional + 16);
  if (plus) bytes.writeBigUInt64LE(0x140000000n, optional + 24); else bytes.writeUInt32LE(0x400000, optional + 28);
  bytes.writeUInt32LE(1024, optional + 60);
  for (let i = 0; i < sections; i++) {
    const p = optional + size + i * 40;
    bytes.writeUInt32LE(0x1000, p + 8); bytes.writeUInt32LE(0x1000, p + 12); bytes.writeUInt32LE(0x800, p + 16); bytes.writeUInt32LE(0x400, p + 20);
  }
  return bytes;
}

test("ELF32 LE and BE map entry using PT_LOAD p_offset, never VA minus assumed image base", () => {
  for (const big of [false, true]) {
    const result = observeNativeBinaryHeader(elfFixture(big), 0x300000)!;
    assert.equal(result.status, "observed"); assert.equal(result.endianness, big ? "big" : "little");
    assert.equal(result.entry.virtual_address, "0x25b718"); assert.equal(result.entry.file_offset, 0x15c718);
    assert.notEqual(result.entry.file_offset, 0x15b718); assert.equal(result.entry.mapping?.p_offset, 0x1000);
    assert.equal(result.entry.entry_bytes_length, 16); assert.equal(result.entry.bytes_hex, undefined);
  }
});
test("ELF BSS, overlaps, incomplete tables and invalid source extents never invent file offsets", () => {
  const bss = elfFixture(); bss.writeUInt32LE(0x100, 52 + 16);
  const overlap = elfFixture(false, 2);
  for (const bytes of [bss, overlap]) {
    const result = observeNativeBinaryHeader(bytes, 0x300000)!;
    assert.equal(result.entry.file_offset, null); assert.match(result.entry.reason, /BSS|ambiguous/);
  }
  assert.equal(observeNativeBinaryHeader(elfFixture().subarray(0, 70), 0x300000)!.status, "incomplete");
  assert.equal(observeNativeBinaryHeader(elfFixture(), 100)!.status, "invalid");
  const range = elfFixture(); range.writeUInt32LE(0x2ffff0, 52 + 4);
  assert.equal(observeNativeBinaryHeader(range, 0x300000)!.status, "invalid");
  const short = elfFixture(); short[4] = 2;
  assert.equal(observeNativeBinaryHeader(short, 0x300000)!.status, "unsupported");
  assert.equal(observeNativeBinaryHeader(elfFixture(), 0x300000, 1), null);
});
test("PE32 and PE32+ preserve RVA/VA/file domains and use section raw pointers", () => {
  for (const plus of [false, true]) {
    const result = observeNativeBinaryHeader(peFixture(plus), 0x3000)!;
    assert.equal(result.status, "observed"); assert.equal(result.class_bits, plus ? 64 : 32);
    assert.equal(result.entry.rva, "0x1120"); assert.equal(result.entry.virtual_address, plus ? "0x140001120" : "0x401120");
    assert.equal(result.entry.file_offset, 0x520); assert.equal(result.entry.mapping?.pointer_to_raw_data, 0x400);
  }
});
test("PE mapping refuses ambiguous, zero-filled, truncated or invalid tables and signatures", () => {
  const bss = peFixture(); bss.writeUInt32LE(0x1900, 0x98 + 16);
  const overlap = peFixture(false, 2);
  for (const bytes of [bss, overlap]) assert.equal(observeNativeBinaryHeader(bytes, 0x3000)!.entry.file_offset, null);
  assert.equal(observeNativeBinaryHeader(peFixture().subarray(0, 400), 0x3000)!.status, "incomplete");
  const broken = peFixture(); broken[0x80] = 0;
  assert.equal(observeNativeBinaryHeader(broken, 0x3000)!.status, "invalid");
  const outside = peFixture(); outside.writeUInt32LE(0x2fff, 0x98 + 224 + 20);
  assert.equal(observeNativeBinaryHeader(outside, 0x3000)!.status, "invalid");
  const short = peFixture(); short.writeUInt16LE(20, 0x80 + 20);
  assert.equal(observeNativeBinaryHeader(short, 0x3000)!.status, "invalid");
  assert.equal(observeNativeBinaryHeader(Buffer.from("ordinary text"), 13), null);
});
