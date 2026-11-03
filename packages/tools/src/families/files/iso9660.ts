/**
 * Bounded ISO9660 primary-namespace reader. ECMA-119 section 9.1 defines the
 * directory identifier length at byte 32 (BP 33), and identifier at byte 33.
 * https://ecma-international.org/publications-and-standards/standards/ecma-119/
 * UDF, Joliet, Rock Ridge, interleaving and multi-extent files are not decoded.
 */
import { open, type FileHandle } from "node:fs/promises";

const SECTOR = 2048;
const MAX_DIRECTORY_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_DIRECTORY_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 50_000;
const MAX_DEPTH = 32;

export interface Iso9660Entry {
  path: string;
  identifier: string;
  kind: "file" | "directory";
  offset: number;
  size: number;
  record_offset: number;
}

export interface Iso9660Issue {
  path: string;
  record_offset: number;
  available: false;
  error: string;
}

class UnavailableFileExtent extends Error {}

function both16(bytes: Buffer, offset: number): number {
  const value = bytes.readUInt16LE(offset);
  if (value !== bytes.readUInt16BE(offset + 2))
    throw new Error("ISO9660 dual-endian 16-bit field mismatch");
  return value;
}

function both32(bytes: Buffer, offset: number): number {
  const value = bytes.readUInt32LE(offset);
  if (value !== bytes.readUInt32BE(offset + 4))
    throw new Error(
      `ISO9660 dual-endian 32-bit field mismatch (${value} versus ${bytes.readUInt32BE(offset + 4)})`,
    );
  return value;
}

function safeName(identifier: Buffer): string {
  if (identifier.some((byte) => byte < 32 || byte > 126))
    throw new Error("Unsupported non-ASCII ISO9660 primary identifier");
  const raw = identifier.toString("ascii");
  const name = raw.replace(/;[0-9]+$/, "");
  if (!name || name === "." || name === ".." || /[\\/:]/.test(name))
    throw new Error("Unsafe ISO9660 member identifier");
  return name;
}

export class Iso9660Image {
  readonly entries: Iso9660Entry[] = [];
  readonly issues: Iso9660Issue[] = [];
  readonly sourceSize: number;
  readonly sourceMtimeMs: number;
  volumeId = "";
  bytesRead = 0;
  private volumeBytes = 0;
  private directoryBytes = 0;
  private readonly visitedDirectories = new Set<number>();

  private constructor(
    readonly path: string,
    private readonly file: FileHandle,
    size: number,
    mtimeMs: number,
    private readonly signal?: AbortSignal,
  ) {
    this.sourceSize = size;
    this.sourceMtimeMs = mtimeMs;
  }

  static async open(path: string, signal?: AbortSignal): Promise<Iso9660Image> {
    const file = await open(path, "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || !Number.isSafeInteger(stat.size))
        throw new Error(
          "Disc image must be an ordinary, safely addressable file",
        );
      const image = new Iso9660Image(
        path,
        file,
        stat.size,
        stat.mtimeMs,
        signal,
      );
      await image.readInventory();
      return image;
    } catch (error) {
      await file.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.file.close();
  }

  async assertUnchanged(): Promise<void> {
    const stat = await this.file.stat();
    if (stat.size !== this.sourceSize || stat.mtimeMs !== this.sourceMtimeMs)
      throw new Error("Disc image changed during inspection or extraction");
  }

  async read(offset: number, size: number): Promise<Buffer> {
    this.signal?.throwIfAborted();
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(size) ||
      offset < 0 ||
      size < 0 ||
      size > 1024 * 1024 ||
      offset > this.sourceSize - size
    ) {
      throw new Error(
        "Disc image read is outside the source or exceeds the bounded chunk size",
      );
    }
    const bytes = Buffer.alloc(size);
    let done = 0;
    while (done < size) {
      this.signal?.throwIfAborted();
      const result = await this.file.read(
        bytes,
        done,
        size - done,
        offset + done,
      );
      if (result.bytesRead === 0)
        throw new Error("Unexpected end of disc image");
      done += result.bytesRead;
      this.bytesRead += result.bytesRead;
    }
    return bytes;
  }

  private record(
    bytes: Buffer,
    recordOffset: number,
  ): { identifier: Buffer; offset: number; size: number; directory: boolean } {
    if (
      bytes.length < 34 ||
      bytes[0] !== bytes.length ||
      bytes.length % 2 !== 0 ||
      bytes[32] === 0 ||
      33 + bytes[32]! > bytes.length ||
      (bytes[32]! % 2 === 0 && bytes[33 + bytes[32]!] !== 0)
    )
      throw new Error("Malformed ISO9660 directory record");
    if (bytes[1] !== 0)
      throw new Error("ISO9660 extended-attribute extents are unsupported");
    if ((bytes[25]! & 0x80) !== 0)
      throw new Error("ISO9660 multi-extent files are unsupported");
    if (bytes[26] !== 0 || bytes[27] !== 0)
      throw new Error("ISO9660 interleaved files are unsupported");
    if (both16(bytes, 28) !== 1)
      throw new Error("ISO9660 multi-volume members are unsupported");
    const directory = (bytes[25]! & 2) !== 0;
    let offset: number, size: number;
    try {
      offset = both32(bytes, 2) * SECTOR;
      size = both32(bytes, 10);
      if (offset > this.volumeBytes - size || offset > this.sourceSize - size)
        throw new Error(
          `ISO9660 extent outside source at record ${recordOffset}`,
        );
    } catch (error) {
      if (directory) throw error;
      throw new UnavailableFileExtent(
        error instanceof Error ? error.message : String(error),
      );
    }
    return {
      identifier: bytes.subarray(33, 33 + bytes[32]!),
      offset,
      size,
      directory,
    };
  }

  private async readInventory(): Promise<void> {
    let primary: Buffer | undefined;
    let terminated = false;
    for (let sector = 16; sector < 80; sector++) {
      const descriptor = await this.read(sector * SECTOR, SECTOR);
      if (
        descriptor.subarray(1, 6).toString("ascii") !== "CD001" ||
        descriptor[6] !== 1
      ) {
        throw new Error(
          "No supported ISO9660 descriptor sequence; raw-sector BIN, UDF-only and other formats are unsupported",
        );
      }
      if (descriptor[0] === 1) {
        if (primary)
          throw new Error(
            "Multiple ISO9660 primary descriptors are unsupported",
          );
        primary = descriptor;
      }
      if (descriptor[0] === 255) {
        terminated = true;
        break;
      }
    }
    if (!primary || !terminated)
      throw new Error(
        "Missing ISO9660 primary descriptor or descriptor terminator within 64 sectors",
      );
    if (both16(primary, 128) !== SECTOR)
      throw new Error("Only 2048-byte ISO9660 logical blocks are supported");
    if (both16(primary, 120) !== 1 || both16(primary, 124) !== 1)
      throw new Error("ISO9660 multi-volume sets are unsupported");
    this.volumeBytes = both32(primary, 80) * SECTOR;
    if (this.volumeBytes > this.sourceSize || this.volumeBytes < 18 * SECTOR)
      throw new Error("Declared ISO9660 volume size is outside the source");
    this.volumeId = primary
      .subarray(40, 72)
      .toString("ascii")
      .replace(/[\0 ]+$/, "");
    const rootLength = primary[156]!;
    const root = this.record(
      primary.subarray(156, 156 + rootLength),
      16 * SECTOR + 156,
    );
    if (
      !root.directory ||
      root.identifier.length !== 1 ||
      root.identifier[0] !== 0
    )
      throw new Error("Invalid ISO9660 root directory record");
    await this.visit(root.offset, root.size, "", root.offset, 0);
    await this.assertUnchanged();
  }

  private async visit(
    offset: number,
    size: number,
    parentPath: string,
    parentOffset: number,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_DEPTH)
      throw new Error("ISO9660 directory depth exceeds 32");
    if (this.visitedDirectories.has(offset))
      throw new Error("ISO9660 directory cycle or aliased directory extent");
    this.visitedDirectories.add(offset);
    if (
      size === 0 ||
      size > MAX_DIRECTORY_BYTES ||
      this.directoryBytes + size > MAX_TOTAL_DIRECTORY_BYTES
    )
      throw new Error("ISO9660 directory byte budget exceeded");
    this.directoryBytes += size;
    const chunks: Buffer[] = [];
    for (let done = 0; done < size; ) {
      const chunk = await this.read(
        offset + done,
        Math.min(1024 * 1024, size - done),
      );
      chunks.push(chunk);
      done += chunk.length;
    }
    const bytes = Buffer.concat(chunks);
    const directories: Iso9660Entry[] = [];
    const names = new Set<string>();
    let selfSeen = false,
      parentSeen = false;
    for (let position = 0; position < size; ) {
      const length = bytes[position]!;
      if (length === 0) {
        const next = Math.min(
          size,
          (Math.floor(position / SECTOR) + 1) * SECTOR,
        );
        if (bytes.subarray(position, next).some((byte) => byte !== 0))
          throw new Error("Malformed nonzero ISO9660 directory padding");
        position = next;
        continue;
      }
      if (position + length > size || (position % SECTOR) + length > SECTOR)
        throw new Error("ISO9660 directory record crosses its logical block");
      const recordBytes = bytes.subarray(position, position + length);
      let row: ReturnType<Iso9660Image["record"]>;
      try {
        row = this.record(recordBytes, offset + position);
      } catch (error) {
        if (!(error instanceof UnavailableFileExtent)) throw error;
        const name = safeName(recordBytes.subarray(33, 33 + recordBytes[32]!));
        if (names.has(name.toUpperCase()))
          throw new Error("Ambiguous duplicate ISO9660 member name or version");
        names.add(name.toUpperCase());
        this.issues.push({
          path: `${parentPath}/${name}`,
          record_offset: offset + position,
          available: false,
          error: error.message,
        });
        if (this.entries.length + this.issues.length > MAX_ENTRIES)
          throw new Error("ISO9660 inventory exceeds 50000 entries");
        position += length;
        continue;
      }
      if (row.identifier.length === 1 && row.identifier[0]! <= 1) {
        const self = row.identifier[0] === 0;
        if (
          !row.directory ||
          row.offset !== (self ? offset : parentOffset) ||
          (self && row.size !== size) ||
          (self ? selfSeen : parentSeen)
        )
          throw new Error("Invalid ISO9660 self/parent directory reference");
        if (self) selfSeen = true;
        else parentSeen = true;
      } else {
        const name = safeName(row.identifier);
        if (names.has(name.toUpperCase()))
          throw new Error("Ambiguous duplicate ISO9660 member name or version");
        names.add(name.toUpperCase());
        const entry: Iso9660Entry = {
          path: `${parentPath}/${name}`,
          identifier: row.identifier.toString("ascii"),
          kind: row.directory ? "directory" : "file",
          offset: row.offset,
          size: row.size,
          record_offset: offset + position,
        };
        this.entries.push(entry);
        if (this.entries.length + this.issues.length > MAX_ENTRIES)
          throw new Error("ISO9660 inventory exceeds 50000 entries");
        if (row.directory) directories.push(entry);
      }
      position += length;
    }
    if (!selfSeen || !parentSeen)
      throw new Error("ISO9660 directory is missing self or parent records");
    for (const entry of directories)
      await this.visit(entry.offset, entry.size, entry.path, offset, depth + 1);
  }
}

export function observeDiscFileHeader(bytes: Buffer): Record<string, unknown> {
  const result: Record<string, unknown> = {
    header_hex: bytes.subarray(0, 64).toString("hex"),
  };
  if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    result.format = "ELF";
    result.class_bits = bytes[4] === 1 ? 32 : bytes[4] === 2 ? 64 : "unknown";
    result.endianness =
      bytes[5] === 1 ? "little" : bytes[5] === 2 ? "big" : "unknown";
    if (bytes.length >= 32 && (bytes[5] === 1 || bytes[5] === 2)) {
      result.machine =
        bytes[5] === 1 ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18);
      if (bytes[4] === 1)
        result.entry = `0x${(bytes[5] === 1 ? bytes.readUInt32LE(24) : bytes.readUInt32BE(24)).toString(16)}`;
    }
  } else if (bytes.subarray(0, 2).toString("ascii") === "MZ") {
    result.format = "DOS MZ executable; PE not yet established";
    if (bytes.length >= 64) {
      const pe = bytes.readUInt32LE(60);
      if (
        pe <= bytes.length - 26 &&
        bytes.subarray(pe, pe + 4).equals(Buffer.from([0x50, 0x45, 0, 0]))
      ) {
        result.format = "PE";
        result.machine = bytes.readUInt16LE(pe + 4);
        result.optional_header_magic = bytes.readUInt16LE(pe + 24);
      }
    }
  } else result.format = "unknown from bounded header";
  return result;
}
