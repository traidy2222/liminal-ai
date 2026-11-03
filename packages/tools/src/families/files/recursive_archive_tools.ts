import {createHash} from 'node:crypto';
import {lstat, open, unlink} from 'node:fs/promises';
import {decodeKnownBinaryHeader, writeArtifact} from '@liminal/core';
import {defineTool} from '../../shared/helpers.js';
import {resolveWithinWorkspace} from '../../shared/file_path_guard.js';
import {prepareDestination} from './iso9660_tools.js';
import {RecursiveNameTableArchive} from './recursive_name_table.js';
import {RECURSIVE_ARCHIVE_PYTHON_REFERENCE} from './recursive_archive_reference.js';

const PROFILE = 'recursive_name_table_v1';
const COVERAGE = 'Explicit observed tagged-directory/name-table profile (for example PS2 Futurama IMG). No magic/version signature: do not select by .img extension alone. Every index record, directory boundary and sector-aligned nonoverlapping file extent is validated; payload structures, meshes, skeletons and animations are not decoded.';
const LAYOUT = {
  header: {offset:0, type:'u32 little-endian', meaning:'Exclusive index end, NOT first payload offset'},
  records: 'Start at byte 4; names are NUL-terminated ASCII. Mask bit 7 of the first name byte; that bit tags a directory. Metadata begins at the next ABSOLUTE 4-byte-aligned offset after the NUL. Padding must be zero.',
  directory: 'One u32 little-endian span at metadata_offset. directory_end = metadata_offset + span; span includes this word. Parse children from metadata_offset+4 up to directory_end, within the parent scope.',
  file: 'Two u32 little-endian fields at metadata_offset: size, then absolute source payload offset. Payload offsets are 2048-byte aligned; ranges must be outside the index, in bounds and nonoverlapping.',
  completion: 'Every index byte must belong to a valid record or its name padding; every directory scope must finish exactly. Do not resynchronize past rejected bytes or infer the whole layout from one valid asset.',
};
const properties = {path: {type: 'string' as const, description: 'Selected source archive path.'}, format: {type: 'string' as const, enum: [PROFILE], description: 'Explicit known layout profile; this is not automatic format detection.'}};

function profile(value: unknown): void {
  if (value !== PROFILE) throw new Error(`Explicit format must be ${PROFILE}; unknown formats are not guessed`);
}
function integer(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error(`Expected an integer from 0 to ${maximum}`);
  return value;
}
async function source(value: unknown): Promise<string> {
  const safe = resolveWithinWorkspace(String(value ?? ''));
  if (!safe.ok || !safe.resolvedPath) throw new Error(safe.error ?? 'Invalid archive source path');
  return safe.resolvedPath;
}

export const inspectBinaryArchiveTool = defineTool({
  name: 'inspect_binary_archive',
  description: 'Inspect a selected archive with an EXPLICIT known layout profile. recursive_name_table_v1 handles the tagged recursive directory/name table observed in PS2 Futurama IMG: directory/file variants and absolute alignment are validated, not guessed by suffix. Bounded index reads, complete extent checks, paginated members and header observations. Returns the complete inventory artifact AND a standalone Python reference parser artifact: copy these to requested inventory.json/parser.py files instead of enumerating every page or rewriting a known parser. Run the copied parser with source --summary to verify it. No payload execution or full-image hash.',
  requiresApproval: false,
  parameters: {type: 'object', properties: {...properties, search: {type: 'string', description: 'Optional case-insensitive member-path substring.'}, offset: {type: 'integer', minimum: 0, description: 'Offset among matching members, default 0.'}, limit: {type: 'integer', minimum: 1, maximum: 200, description: 'Requested members per page, default 50, also bounded by a 24 KiB JSON budget.'}}, required: ['path', 'format'], additionalProperties: false},
  handler: async (args, _emit, _harness, context) => {
    let archive: RecursiveNameTableArchive | undefined;
    try {
      profile(args.format);
      const offset = integer(args.offset, 0, 50_000), limit = integer(args.limit, 50, 200);
      if (!limit) throw new Error('limit must be at least 1');
      archive = await RecursiveNameTableArchive.open(await source(args.path), context?.signal);
      const files = archive.entries.filter(entry => entry.kind === 'file').length;
      const inventory = {format: PROFILE, source: archive.path, source_size: archive.sourceSize,
        source_mtime_ms: archive.sourceStat.mtimeMs, index_end: archive.indexEnd, index_sha256: archive.indexSha256,
        validation: {index_consumed_exactly: true, file_extents_in_bounds: true, file_extents_sector_aligned: true, file_extents_nonoverlapping: true},
        coverage: COVERAGE, layout: LAYOUT, record_count: archive.entries.length, file_count: files, directory_count: archive.entries.length - files,
        entries: archive.entries};
      const document = JSON.stringify(inventory, null, 2), hash = createHash('sha256').update(document).digest('hex');
      await archive.assertUnchanged();
      const artifactPath = await writeArtifact(hash, document);
      const referenceHash = createHash('sha256').update(RECURSIVE_ARCHIVE_PYTHON_REFERENCE).digest('hex');
      const referencePath = await writeArtifact(referenceHash, RECURSIVE_ARCHIVE_PYTHON_REFERENCE);
      context?.signal?.throwIfAborted();
      const matching = archive.entries.filter(entry => entry.path.toLowerCase().includes(String(args.search ?? '').toLowerCase()));
      const page: Array<Record<string, unknown>> = [];
      const base = {format: PROFILE, source: archive.path, source_size: archive.sourceSize, index_end: archive.indexEnd,
        index_sha256: archive.indexSha256, validation: inventory.validation, coverage: COVERAGE, layout: LAYOUT, record_count: archive.entries.length,
        file_count: files, directory_count: archive.entries.length - files, matched_count: matching.length,
        inventory_artifact: {hash, path: artifactPath, complete_inventory: true, note: 'JSON inventory of validated index/extent facts; source payload content is not fully hashed or decoded.'},
        reference_parser_artifact: {hash:referenceHash,path:referencePath,language:'python',standalone:true,
          verify_command_args:[archive.path,'--summary'],
          usage:'Copy this artifact to a NEW workspace parser.py using a normal file tool, then run the copied script with verify_command_args using the existing Python runtime. The parameterized reference implements this profile; do not rewrite it. Default stdout is complete JSON; --summary is compact. It only reads the source and writes stdout.'}};
      for (const entry of matching.slice(offset, offset + limit)) {
        let observations;
        if (entry.kind === 'file') {
          const prefix = await archive.read(entry.offset!, Math.min(entry.size!, 256));
          observations = {offset_basis:'member payload start', member_source_offset:entry.offset,
            header_hex: prefix.subarray(0,64).toString('hex'), format_observation: decodeKnownBinaryHeader(prefix)};
        }
        const item = {...entry, ...(observations ? {observations} : {})};
        const preview = JSON.stringify({...base, offset, next_offset: offset + page.length + 1, entries: [...page,item]});
        if (Buffer.byteLength(preview, 'utf8') > 23_700) {
          if (!page.length) throw new Error('One archive member exceeds the bounded response budget; use a more specific member search');
          break;
        }
        page.push(item);
      }
      await archive.assertUnchanged();
      return {ok: true, output: JSON.stringify({...base, offset, next_offset: offset + page.length < matching.length ? offset + page.length : null,
        entries: page, bytes_read: archive.bytesRead})};
    } catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
    finally { await archive?.close(); }
  },
});

export const extractArchiveFileTool = defineTool({
  name: 'extract_archive_file',
  description: 'Extract one exact validated member from an explicitly profiled binary archive into a NEW selected file inside the workspace. recursive_name_table_v1 uses inspect_binary_archive member paths. Streaming SHA-256, exact extent and bounded header observations; no overwrite, source changes, target execution or implicit format guessing.',
  requiresApproval: true,
  dangerLevel: 'cautious',
  parameters: {type: 'object', properties: {...properties, member_path: {type: 'string', description: 'Exact case-sensitive file member path returned by inspect_binary_archive.'}, destination: {type: 'string', description: 'New destination file path inside the active workspace.'}}, required: ['path','format','member_path','destination'], additionalProperties: false},
  handler: async (args, emit, _harness, context) => {
    let archive: RecursiveNameTableArchive | undefined;
    let output: Awaited<ReturnType<typeof open>> | undefined;
    let destination: string | undefined;
    let created: {dev: bigint; ino: bigint} | undefined;
    let complete = false;
    try {
      profile(args.format);
      archive = await RecursiveNameTableArchive.open(await source(args.path), context?.signal);
      const member = archive.entries.find(entry => entry.path === args.member_path);
      if (!member || member.kind !== 'file') throw new Error('Exact file member not found; use member_path from inspect_binary_archive');
      destination = await prepareDestination(String(args.destination ?? ''));
      context?.signal?.throwIfAborted();
      output = await open(destination, 'wx');
      const info = await output.stat({bigint: true}); created = {dev: info.dev, ino: info.ino};
      const hash = createHash('sha256'); let done = 0; let prefix: Buffer = Buffer.alloc(0);
      emit?.(`Extracting ${member.path} (${member.size} bytes)`);
      while (done < member.size!) {
        context?.signal?.throwIfAborted();
        const bytes = await archive.read(member.offset! + done, Math.min(1024 * 1024, member.size! - done));
        if (!done) prefix = bytes.subarray(0,256);
        hash.update(bytes);
        for (let written = 0; written < bytes.length;) {
          context?.signal?.throwIfAborted();
          const value = await output.write(bytes, written, bytes.length - written);
          if (!value.bytesWritten) throw new Error('Archive extraction made no write progress');
          written += value.bytesWritten;
        }
        done += bytes.length;
      }
      await archive.assertUnchanged(); await output.sync(); context?.signal?.throwIfAborted(); complete = true;
      return {ok: true, output: JSON.stringify({format: PROFILE, source: archive.path, member_path: member.path,
        index_sha256: archive.indexSha256, source_offset: member.offset, size: done, destination, sha256: hash.digest('hex'),
        format_observation: decodeKnownBinaryHeader(prefix), format_observation_offset_basis:'extracted file start', coverage: COVERAGE})};
    } catch (error) { return {ok: false, error: error instanceof Error ? error.message : String(error)}; }
    finally {
      await output?.close(); await archive?.close();
      if (!complete && created && destination) {
        const current = await lstat(destination, {bigint: true}).catch(() => undefined);
        if (current && !current.isSymbolicLink() && current.dev === created.dev && current.ino === created.ino)
          await unlink(destination).catch(() => {});
      }
    }
  },
});
