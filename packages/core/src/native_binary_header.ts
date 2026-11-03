/** Bounded static header facts. Addresses and file offsets are distinct domains. */
export interface NativeEntryObservation {
  virtual_address: string | null;
  rva: string | null;
  file_offset: number | null;
  mapping_status: "mapped" | "unknown";
  reason: string;
  entry_bytes_length?: number;
  bytes_hex?: string;
  mapping?: Record<string, number | string>;
}
export interface NativeBinaryHeaderObservation {
  format: "ELF" | "PE";
  status: "observed" | "incomplete" | "unsupported" | "invalid";
  source_size: number;
  header_bytes_observed: number;
  class_bits?: number;
  endianness?: "little" | "big";
  machine?: number;
  architecture?: string;
  image_base?: string;
  program_header_count?: number;
  section_count?: number;
  entry: NativeEntryObservation;
  coverage: string;
}

const hex = (value: number | bigint) => `0x${value.toString(16)}`;
const range = (offset: number, length: number, size: number) => Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 && offset <= size && length <= size - offset;
const emptyEntry = (): NativeEntryObservation => ({ virtual_address: null, rva: null, file_offset: null, mapping_status: "unknown", reason: "Entry mapping has not been established." });

/** No I/O or execution. Only a contiguous prefix beginning at source offset 0 can establish headers. */
export function observeNativeBinaryHeader(prefix: Buffer, sourceSize: number, offset = 0): NativeBinaryHeaderObservation | null {
  if (offset !== 0) return null;
  const elf = prefix.length >= 4 && prefix.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const mz = prefix.length >= 2 && prefix[0] === 0x4d && prefix[1] === 0x5a;
  if (!elf && !mz) return null;
  const out: NativeBinaryHeaderObservation = {
    format: elf ? "ELF" : "PE", status: "observed", source_size: sourceSize,
    header_bytes_observed: prefix.length, entry: emptyEntry(),
    coverage: "Static bounded header/table observations only; no disassembly, execution, source recovery or loader acceptance is implied.",
  };
  const stop = (status: NativeBinaryHeaderObservation["status"], reason: string) => {
    out.status = status; out.entry.reason = reason; return out;
  };
  if (!Number.isSafeInteger(sourceSize) || sourceSize < 0 || prefix.length > sourceSize) return stop("invalid", "Invalid source size or prefix extends beyond the source.");
  const requireBytes = (start: number, count: number, label: string) => {
    if (!range(start, count, sourceSize)) { stop("invalid", `${label} lies outside the source file.`); return false; }
    if (!range(start, count, prefix.length)) { stop("incomplete", `${label} is not complete in the bounded prefix; mapping remains unknown.`); return false; }
    return true;
  };
  const mapped = (fileOffset: number, backed: number, mapping: Record<string, number | string>) => {
    const count = Math.min(16, backed, sourceSize - fileOffset);
    out.entry = { ...out.entry, file_offset: fileOffset, mapping_status: "mapped", reason: "Unique file-backed entry mapping established from the complete bounded table.", entry_bytes_length: count, mapping };
    if (range(fileOffset, count, prefix.length)) out.entry.bytes_hex = prefix.subarray(fileOffset, fileOffset + count).toString("hex");
    return out;
  };
  if (elf) {
    if (!requireBytes(0, 16, "ELF identification")) return out;
    out.class_bits = prefix[4] === 1 ? 32 : prefix[4] === 2 ? 64 : undefined;
    if (prefix[4] !== 1) return stop("unsupported", "Only ELF32 header mapping is supported; ELF64/unknown classes remain unknown.");
    if (prefix[5] !== 1 && prefix[5] !== 2) return stop("invalid", "Invalid ELF byte order.");
    out.endianness = prefix[5] === 1 ? "little" : "big";
    if (!requireBytes(0, 52, "ELF32 header")) return out;
    const u16 = (n: number) => prefix[5] === 1 ? prefix.readUInt16LE(n) : prefix.readUInt16BE(n);
    const u32 = (n: number) => prefix[5] === 1 ? prefix.readUInt32LE(n) : prefix.readUInt32BE(n);
    if (prefix[6] !== 1 || u32(20) !== 1 || u16(40) !== 52) return stop("invalid", "Invalid ELF32 version/header size.");
    out.machine = u16(18); out.architecture = ({ 3: "x86", 8: "mips", 40: "arm" } as Record<number, string>)[out.machine] ?? "unknown";
    const entry = u32(24), phoff = u32(28), width = u16(42), count = u16(44);
    out.entry.virtual_address = hex(entry); out.program_header_count = count;
    if (![2, 3].includes(u16(16))) return stop("unsupported", "ELF input is not an executable/shared object; entry mapping is not established.");
    if (!count) return stop("observed", "ELF has no program headers; entry file offset is unknown.");
    if (count > 4096 || width !== 32) return stop("unsupported", "ELF program-header count/entry size exceeds the supported bounded profile.");
    if (phoff < 52) return stop("invalid", "ELF program-header table overlaps the fixed header.");
    if (!requireBytes(phoff, width * count, "ELF program-header table")) return out;
    const candidates: Array<{ index: number; position: number; virtual: number; file: number; memory: number }> = [];
    for (let i = 0; i < count; i++) {
      const p = phoff + i * width;
      if (u32(p) !== 1) continue; // PT_LOAD only.
      const position = u32(p + 4), virtual = u32(p + 8), file = u32(p + 16), memory = u32(p + 20);
      if (file > memory || virtual + memory > 0x1_0000_0000 || !range(position, file, sourceSize)) return stop("invalid", "ELF PT_LOAD file/memory range is invalid or outside the source.");
      if (entry >= virtual && entry - virtual < memory) candidates.push({ index: i, position, virtual, file, memory });
    }
    if (entry === 0) return stop("observed", "ELF entry address is zero; no entry file mapping is asserted.");
    if (candidates.length !== 1) return stop("observed", candidates.length ? "Entry overlaps multiple PT_LOAD ranges; file mapping is ambiguous." : "Entry is not covered by any PT_LOAD memory range.");
    const segment = candidates[0]!, delta = entry - segment.virtual;
    if (delta >= segment.file) return stop("observed", "Entry lies in a zero-filled/BSS PT_LOAD tail with no file-backed bytes.");
    return mapped(segment.position + delta, segment.file - delta, { rule: "p_offset + (entry_virtual_address - p_vaddr)", program_header_index: segment.index, p_offset: segment.position, p_vaddr: hex(segment.virtual), p_filesz: segment.file, p_memsz: segment.memory });
  }

  if (!requireBytes(0, 64, "DOS header for PE location")) return out;
  const pe = prefix.readUInt32LE(60);
  if (pe < 64) return stop("invalid", "PE signature location overlaps the DOS header.");
  if (!requireBytes(pe, 24, "PE signature/COFF header")) return out;
  if (!prefix.subarray(pe, pe + 4).equals(Buffer.from([0x50, 0x45, 0, 0]))) return stop("invalid", "DOS MZ signature is present but the PE signature is not established.");
  out.machine = prefix.readUInt16LE(pe + 4); out.architecture = ({ 0x14c: "x86", 0x8664: "x86_64", 0x1c4: "arm", 0xaa64: "arm64" } as Record<number, string>)[out.machine] ?? "unknown";
  const count = prefix.readUInt16LE(pe + 6), optionalSize = prefix.readUInt16LE(pe + 20), optional = pe + 24;
  out.section_count = count;
  if (!requireBytes(optional, optionalSize, "PE optional header")) return out;
  if (optionalSize < 2) return stop("invalid", "PE optional header has no magic.");
  const magic = prefix.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) return stop("unsupported", "PE optional-header magic is outside PE32/PE32+.");
  out.class_bits = magic === 0x10b ? 32 : 64; out.endianness = "little";
  if (optionalSize < (magic === 0x10b ? 96 : 112)) return stop("invalid", "PE optional header is shorter than its declared class requires.");
  const rva = prefix.readUInt32LE(optional + 16), imageBase = magic === 0x10b ? BigInt(prefix.readUInt32LE(optional + 28)) : prefix.readBigUInt64LE(optional + 24);
  const headersSize = prefix.readUInt32LE(optional + 60), sectionTable = optional + optionalSize;
  out.image_base = hex(imageBase); out.entry.rva = hex(rva); out.entry.virtual_address = hex(imageBase + BigInt(rva));
  if (imageBase + BigInt(rva) > 0xffff_ffff_ffff_ffffn || headersSize > sourceSize) return stop("invalid", "PE image/header address range is invalid.");
  if (!count || count > 4096) return stop("unsupported", "PE section count is outside the bounded supported profile.");
  if (!requireBytes(sectionTable, count * 40, "PE section table")) return out;
  if (headersSize < sectionTable + count * 40) return stop("invalid", "PE SizeOfHeaders does not contain the complete section table.");
  const candidates: Array<{ index: number; position: number; virtual: number; raw: number }> = [];
  if (rva < headersSize) candidates.push({ index: -1, position: 0, virtual: 0, raw: headersSize });
  for (let i = 0; i < count; i++) {
    const p = sectionTable + i * 40, size = prefix.readUInt32LE(p + 8), virtual = prefix.readUInt32LE(p + 12), raw = prefix.readUInt32LE(p + 16), position = prefix.readUInt32LE(p + 20);
    const extent = Math.max(size, raw);
    if (virtual + extent > 0x1_0000_0000 || (raw > 0 && !range(position, raw, sourceSize))) return stop("invalid", "PE section file/virtual range is invalid or outside the source.");
    if (rva >= virtual && rva - virtual < extent) candidates.push({ index: i, position, virtual, raw });
  }
  if (!rva) return stop("observed", "PE entry RVA is zero; no entry file mapping is asserted.");
  if (candidates.length !== 1) return stop("observed", candidates.length ? "Entry RVA overlaps multiple header/section ranges; mapping is ambiguous." : "Entry RVA is not covered by any section/header range.");
  const section = candidates[0]!, delta = rva - section.virtual;
  if (delta >= section.raw) return stop("observed", "Entry RVA lies in a zero-filled section tail with no file-backed bytes.");
  return mapped(section.position + delta, section.raw - delta, { rule: section.index < 0 ? "header RVA equals file offset" : "PointerToRawData + (entry_RVA - section_VirtualAddress)", section_index: section.index, pointer_to_raw_data: section.position, section_virtual_address: hex(section.virtual), size_of_raw_data: section.raw });
}
