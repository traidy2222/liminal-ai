/** Explicit observed profile: recursive tagged-name index used by PS2 IMG
 * archives. There is no magic/version field: never select by filename alone.
 * All index records and payload extents must validate before any inventory is
 * returned. Payload semantics remain unknown.
 */
import {constants, type Stats} from 'node:fs';
import {open, stat, type FileHandle} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';

const MAX_INDEX = 16 * 1024 * 1024;
const MAX_RECORDS = 50_000;
const MAX_DEPTH = 32;
const MAX_PATH_CHARACTERS = 16 * 1024 * 1024;

export interface RecursiveArchiveEntry {
  path: string;
  identifier: string;
  kind: 'file' | 'directory';
  record_offset: number;
  metadata_offset: number;
  record_end: number;
  offset?: number;
  size?: number;
  directory_end?: number;
}

export class RecursiveNameTableArchive {
  readonly entries: RecursiveArchiveEntry[] = [];
  indexEnd = 0;
  indexSha256 = '';
  bytesRead = 0;
  maxDepth = 0;

  private constructor(readonly path: string, private readonly handle: FileHandle,
    readonly sourceStat: Stats, private readonly signal?: AbortSignal) {}

  get sourceSize(): number { return this.sourceStat.size; }

  static async open(path: string, signal?: AbortSignal): Promise<RecursiveNameTableArchive> {
    signal?.throwIfAborted();
    const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 4)
        throw new Error('Archive must be an ordinary, safely addressable file with an index boundary');
      const archive = new RecursiveNameTableArchive(path, handle, info, signal);
      await archive.load();
      await archive.assertUnchanged();
      return archive;
    } catch (error) { await handle.close(); throw error; }
  }

  async close(): Promise<void> { await this.handle.close(); }

  async assertUnchanged(): Promise<void> {
    this.signal?.throwIfAborted();
    const [opened, current] = await Promise.all([this.handle.stat(), stat(this.path)]);
    for (const value of [opened, current]) {
      if (!value.isFile() || value.dev !== this.sourceStat.dev || value.ino !== this.sourceStat.ino ||
          value.size !== this.sourceStat.size || value.mtimeMs !== this.sourceStat.mtimeMs || value.ctimeMs !== this.sourceStat.ctimeMs)
        throw new Error('Archive source changed during inspection or extraction');
    }
    this.signal?.throwIfAborted();
  }

  async read(offset: number, size: number): Promise<Buffer> {
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || size > 1024 * 1024 || offset > this.sourceSize - size)
      throw new Error('Archive read exceeds its source extent or bounded chunk size');
    const bytes = Buffer.alloc(size);
    for (let done = 0; done < size;) {
      this.signal?.throwIfAborted();
      const {bytesRead} = await this.handle.read(bytes, done, size - done, offset + done);
      if (!bytesRead) throw new Error('Unexpected end of archive');
      done += bytesRead; this.bytesRead += bytesRead;
    }
    return bytes;
  }

  private async load(): Promise<void> {
    this.indexEnd = (await this.read(0, 4)).readUInt32LE(0);
    if (this.indexEnd < 4 || this.indexEnd % 4 || this.indexEnd > Math.min(this.sourceSize, MAX_INDEX))
      throw new Error('Invalid recursive-name-table index boundary (maximum 16 MiB)');
    const index = Buffer.alloc(this.indexEnd);
    for (let offset = 0; offset < index.length; offset += 1024 * 1024)
      (await this.read(offset, Math.min(1024 * 1024, index.length - offset))).copy(index, offset);
    this.indexSha256 = createHash('sha256').update(index).digest('hex');
    const seen = new Set<string>();
    let pathCharacters = 0;
    const visit = async (start: number, end: number, parent: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) throw new Error('Recursive archive directory depth exceeds 32');
      this.maxDepth = Math.max(this.maxDepth, depth);
      let position = start;
      while (position < end) {
        this.signal?.throwIfAborted();
        if (this.entries.length >= MAX_RECORDS) throw new Error('Recursive archive record count exceeds 50000');
        if (this.entries.length && this.entries.length % 512 === 0) await setImmediate();
        this.signal?.throwIfAborted();
        const directory = (index[position]! & 0x80) !== 0;
        const nameEnd = index.indexOf(0, position);
        if (nameEnd < position || nameEnd >= Math.min(end, position + 257))
          throw new Error('Archive member has no bounded name terminator (maximum 256 bytes)');
        const nameBytes = Buffer.from(index.subarray(position, nameEnd));
        if (!nameBytes.length) throw new Error('Archive member name is empty');
        nameBytes[0] = nameBytes[0]! & 0x7f;
        if (nameBytes.some(value => value < 32 || value > 126)) throw new Error('Unsupported recursive archive name encoding');
        const name = nameBytes.toString('ascii');
        if (name === '.' || name === '..' || /[\\/:]/.test(name)) throw new Error('Unsafe recursive archive member name');
        const memberPath = parent ? `${parent}/${name}` : name;
        pathCharacters += memberPath.length;
        if (memberPath.length > 4096 || pathCharacters > MAX_PATH_CHARACTERS) throw new Error('Recursive archive path resource limit exceeded');
        if (seen.has(memberPath)) throw new Error(`Duplicate recursive archive member path: ${memberPath}`);
        seen.add(memberPath);
        const metadata = Math.ceil((nameEnd + 1) / 4) * 4;
        if (metadata + (directory ? 4 : 8) > end) throw new Error('Archive record fields cross a directory/index boundary');
        if (index.subarray(nameEnd, metadata).some(value => value !== 0)) throw new Error('Archive name padding is not zero');
        const recordEnd = metadata + (directory ? 4 : 8);
        if (directory) {
          const span = index.readUInt32LE(metadata), directoryEnd = metadata + span;
          if (span < 4 || span % 4 || directoryEnd > end) throw new Error('Invalid recursive archive directory span');
          this.entries.push({path: memberPath, identifier: name, kind: 'directory', record_offset: position,
            metadata_offset: metadata, record_end: recordEnd, directory_end: directoryEnd});
          await visit(recordEnd, directoryEnd, memberPath, depth + 1);
          position = directoryEnd;
        } else {
          const size = index.readUInt32LE(metadata), offset = index.readUInt32LE(metadata + 4);
          if (offset < this.indexEnd || offset % 2048 || offset > this.sourceSize - size)
            throw new Error(`Invalid/alignment or out-of-range archive payload extent for ${memberPath}`);
          this.entries.push({path: memberPath, identifier: name, kind: 'file', record_offset: position,
            metadata_offset: metadata, record_end: recordEnd, offset, size});
          position = recordEnd;
        }
      }
      if (position !== end) throw new Error('Recursive archive directory/index was not consumed exactly');
    };
    await visit(4, this.indexEnd, '', 0);
    const extents = this.entries.filter((entry): entry is RecursiveArchiveEntry & {offset: number; size: number} => entry.kind === 'file' && entry.size! > 0)
      .sort((left, right) => left.offset! - right.offset!);
    for (let i = 1; i < extents.length; i++) {
      const previous = extents[i - 1]!, current = extents[i]!;
      if (previous.offset + previous.size > current.offset) throw new Error('Recursive archive payload extents overlap');
    }
  }
}
