import { createReadStream } from "node:fs";
import { stat, open, type FileHandle } from "node:fs/promises";
import { isUtf8 } from "node:buffer";
import crypto from "node:crypto";
import { defineTool } from "../../shared/helpers.js";
import { resolveWithinWorkspace } from "../../shared/file_path_guard.js";
import { observeNativeBinaryHeader } from "@liminal/core";

const TEXT_LINE_COUNT_MAX_BYTES = 1024 * 1024;
const HEADER_SAMPLE_BYTES = 4096;
const ISO_SIGNATURE_OFFSET = 0x8001;

async function readBounded(handle: FileHandle, length: number, position = 0): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

function signatureFormat(header: Buffer): string | null {
  const hex = header.subarray(0, 4).toString("hex");
  if (hex === "7f454c46") return "elf";
  if (["504b0304", "504b0506", "504b0708"].includes(hex)) return "zip";
  if (header.subarray(0, 2).toString("latin1") === "MZ") return "dos-mz";
  if (hex === "89504e47") return "png";
  if (header.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  return null;
}

async function rawFileHash(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file, { highWaterMark: 256 * 1024 })) hash.update(chunk);
  return hash.digest("hex");
}

export const fileMetadataTool = defineTool({
  name: "file_metadata",
  description:
    "WHAT: Return file/directory metadata, a bounded hex header and signature hint. For complete supported ELF32/PE headers, distinguish entry virtual/RVA/file offsets using segment/section tables and read at most16 mapped entry bytes. Count lines only for UTF-8 text up to 1 MiB; otherwise return null with a coverage note. Optional SHA-256 streams raw bytes with bounded memory.\n" +
    "WHEN: Verification, binary/header inspection, drift checks or chunking strategy. Set include_hash:false for quick metadata on large game images; hashing reads the entire file.",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 10_000,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to inspect." },
      include_hash: { type: "boolean", description: "Include raw-byte SHA-256 (default true). Set false to avoid a full file scan for large binaries/images." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const safe = resolveWithinWorkspace(String(args["path"] ?? ""));
    if (!safe.ok || !safe.resolvedPath) return { ok: false, error: safe.error ?? "invalid path" };
    const includeHash = args["include_hash"] === undefined ? true : Boolean(args["include_hash"]);
    try {
      const s = await stat(safe.resolvedPath);
      const out: Record<string, unknown> = {
        path: safe.resolvedPath,
        kind: s.isDirectory() ? "directory" : s.isFile() ? "file" : "other",
        size_bytes: s.size,
        mtime: s.mtime.toISOString(),
        ctime: s.ctime.toISOString(),
        line_count: null,
      };
      if (!s.isFile()) {
        out["line_count_note"] = `Not applicable to ${out["kind"]} metadata.`;
        if (includeHash) {
          out["sha256"] = null;
          out["sha256_note"] = "Not applicable: only regular files are hashed.";
        }
        return { ok: true, output: JSON.stringify(out, null, 2) };
      }

      const handle = await open(safe.resolvedPath, "r");
      let sample: Buffer;
      let format: string | null;
      try {
        const fullTextCandidate = s.size <= TEXT_LINE_COUNT_MAX_BYTES;
        sample = await readBounded(handle, fullTextCandidate ? s.size : HEADER_SAMPLE_BYTES);
        format = signatureFormat(sample);
        const native = observeNativeBinaryHeader(sample.subarray(0, HEADER_SAMPLE_BYTES), s.size);
        if (native) {
          out.native_header = native;
          if (native.entry.mapping_status === "mapped" && native.entry.file_offset !== null) {
            const mapped = await readBounded(handle, native.entry.entry_bytes_length ?? 0, native.entry.file_offset);
            out.mapped_entry_bytes = {
              file_offset: native.entry.file_offset, length: mapped.length, hex: mapped.toString("hex"),
              coverage: "File-backed bytes at the entry offset established by the native header table; no instruction decoding or execution.",
            };
          }
        }
        if (!format && s.size >= ISO_SIGNATURE_OFFSET + 5) {
          const isoSignature = await readBounded(handle, 5, ISO_SIGNATURE_OFFSET);
          if (isoSignature.toString("latin1") === "CD001") format = "iso9660";
        }
        if (!fullTextCandidate) {
          out["line_count_note"] = "Not counted: file exceeds the bounded 1 MiB UTF-8 text line-count limit; only a header sample was inspected.";
        } else if (!isUtf8(sample) || /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(sample.toString("utf8"))) {
          out["line_count_note"] = "Not counted: binary data or text outside the supported UTF-8/control-character profile.";
        } else {
          let lines = 1;
          for (const byte of sample) if (byte === 0x0a) lines += 1;
          out["line_count"] = lines;
          out["line_count_note"] = "Counted the complete UTF-8 file using LF/CRLF separators, including an empty final line after a trailing newline.";
        }
      } finally {
        await handle.close();
      }
      out["header_hex"] = sample.subarray(0, 64).toString("hex");
      out["detected_format"] = format;
      out["format_note"] = "detected_format is a signature hint. native_header, when present, records bounded supported header/table facts and explicit mapping limits; no execution or disassembly was performed.";
      if (includeHash) out["sha256"] = await rawFileHash(safe.resolvedPath);
      return { ok: true, output: JSON.stringify(out, null, 2) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});

