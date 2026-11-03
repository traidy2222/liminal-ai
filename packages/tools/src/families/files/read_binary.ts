import { open } from "node:fs/promises";
import { defineTool } from "../../shared/helpers.js";
import { resolveWithinWorkspace } from "../../shared/file_path_guard.js";

const MAX_BYTES = 65_536;
const MAX_RESULTS = 200;
const MAX_STRING_TEXT = 256;
// Leave headroom beneath this tool's dispatcher cap (8192 * 4 characters).
// Budget the actual serialized JSON: escaping can double printable ASCII text.
const MAX_SERIALIZED_BYTES = 24_000;

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

function ascii(bytes: Buffer): string {
  return Array.from(bytes, (byte) =>
    byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".",
  ).join("");
}

export const readBinaryTool = defineTool({
  name: "read_binary",
  description:
    "Read a bounded byte window from a local binary without generating scripts, decoding UTF-8, executing it or reading the whole file. Views: hex+ASCII rows, unsigned u32le words, or printable ASCII string runs. Length defaults to256 and is at most65536 bytes. Results default to64 rows/words/strings, maximum200, within a24000-byte serialized JSON budget. next_offset resumes first undisplayed data when either result cap applies; read_end_offset and bytes_read describe the actual read window. String text is clipped at256 characters with original offset/observed length retained. These are byte observations, not inferred format semantics.",
  requiresApproval: false,
  maxOutputTokens: 8192,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the selected binary or archive.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        description: "Absolute byte offset, default0.",
      },
      length: {
        type: "integer",
        minimum: 1,
        maximum: MAX_BYTES,
        description:
          "Byte window length, default256, maximum65536; clips at EOF.",
      },
      view: {
        type: "string",
        enum: ["hex", "u32le", "strings"],
        description: "Observation view, default hex.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: MAX_RESULTS,
        description:
          "Rendered rows, words or string runs, default64, maximum200.",
      },
      min_length: {
        type: "integer",
        minimum: 4,
        maximum: 256,
        description:
          "Minimum printable ASCII run length for strings view, default4.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args, _emit, _harness, context) => {
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      context?.signal?.throwIfAborted();
      const safe = resolveWithinWorkspace(String(args.path ?? ""));
      if (!safe.ok || !safe.resolvedPath)
        throw new Error(safe.error ?? "Invalid binary file path");
      const offset = integer(
        args.offset,
        0,
        0,
        Number.MAX_SAFE_INTEGER,
        "offset",
      );
      const length = integer(args.length, 256, 1, MAX_BYTES, "length");
      const limit = integer(args.limit, 64, 1, MAX_RESULTS, "limit");
      const minimum = integer(args.min_length, 4, 4, 256, "min_length");
      const view = args.view === undefined ? "hex" : args.view;
      if (view !== "hex" && view !== "u32le" && view !== "strings")
        throw new Error("view must be hex, u32le or strings");
      file = await open(safe.resolvedPath, "r");
      context?.signal?.throwIfAborted();
      const before = await file.stat();
      if (!before.isFile() || !Number.isSafeInteger(before.size))
        throw new Error(
          "read_binary requires an ordinary, safely addressable file",
        );
      if (offset > before.size)
        throw new Error(`offset ${offset} is past EOF ${before.size}`);
      const bytes = Buffer.alloc(Math.min(length, before.size - offset));
      let done = 0;
      while (done < bytes.length) {
        context?.signal?.throwIfAborted();
        const result = await file.read(
          bytes,
          done,
          bytes.length - done,
          offset + done,
        );
        if (result.bytesRead === 0)
          throw new Error(
            "File ended before the requested observation window; it may have changed",
          );
        done += result.bytesRead;
      }
      context?.signal?.throwIfAborted();
      const after = await file.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
        throw new Error("Binary file changed during observation");

      let consumed = done;
      const observations: Record<string, unknown> = {};
      if (view === "hex") {
        const rows = [];
        for (let i = 0; i < done && rows.length < limit; i += 16) {
          const row = bytes.subarray(i, Math.min(i + 16, done));
          rows.push({
            offset: offset + i,
            hex: Array.from(row, (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join(" "),
            ascii: ascii(row),
          });
        }
        consumed = Math.min(done, rows.length * 16);
        observations.rows = rows;
      } else if (view === "u32le") {
        const words = [];
        for (let i = 0; i + 4 <= done && words.length < limit; i += 4) {
          const value = bytes.readUInt32LE(i);
          words.push({
            offset: offset + i,
            value,
            hex: `0x${value.toString(16).padStart(8, "0")}`,
            bytes_hex: bytes.subarray(i, i + 4).toString("hex"),
          });
        }
        const wordBytes = words.length * 4;
        if (wordBytes + 4 <= done) consumed = wordBytes;
        else if (wordBytes < done)
          observations.trailing_bytes = {
            offset: offset + wordBytes,
            hex: bytes.subarray(wordBytes).toString("hex"),
          };
        observations.words = words;
        observations.interpretation =
          "unsigned 32-bit little-endian words beginning at the explicit requested offset";
      } else {
        const strings = [];
        let start = 0;
        while (start < done) {
          if (bytes[start]! < 32 || bytes[start]! > 126) {
            start++;
            continue;
          }
          let end = start + 1;
          while (end < done && bytes[end]! >= 32 && bytes[end]! <= 126) end++;
          if (end - start >= minimum) {
            if (strings.length === limit) {
              consumed = start;
              break;
            }
            strings.push({
              offset: offset + start,
              length: end - start,
              text: bytes
                .subarray(start, Math.min(start + MAX_STRING_TEXT, end))
                .toString("ascii"),
              text_truncated: end - start > MAX_STRING_TEXT,
              begins_at_window_boundary: start === 0,
              ends_at_window_boundary: end === done,
            });
          }
          start = end;
        }
        observations.strings = strings;
        observations.coverage =
          "Printable ASCII bytes32..126 only. Boundary runs can continue beyond this read window; names, types and object semantics are not inferred.";
      }
      let outputBudgetApplied = false;
      const serialize = () => {
        const next = offset + consumed;
        return JSON.stringify(
          {
            path: safe.resolvedPath,
            total_size: before.size,
            offset,
            requested_length: length,
            bytes_read: done,
            read_end_offset: offset + done,
            view,
            limit,
            output_budget_bytes: MAX_SERIALIZED_BYTES,
            output_budget_applied: outputBudgetApplied,
            results_truncated: consumed < done,
            next_offset: next < before.size ? next : null,
            ...observations,
          },
          null,
          2,
        );
      };
      const key =
        view === "hex" ? "rows" : view === "u32le" ? "words" : "strings";
      const rendered = observations[key] as Array<{ offset: number }>;
      let output = serialize();
      while (
        Buffer.byteLength(output, "utf8") > MAX_SERIALIZED_BYTES &&
        rendered.length
      ) {
        context?.signal?.throwIfAborted();
        // Removing from the end retains original order. The earliest removed
        // item is the exact next page boundary, not the end of the read window.
        const omitted = rendered.pop()!;
        consumed = omitted.offset - offset;
        outputBudgetApplied = true;
        delete observations.trailing_bytes;
        output = serialize();
      }
      if (Buffer.byteLength(output, "utf8") > MAX_SERIALIZED_BYTES)
        throw new Error(
          "Binary observation metadata exceeds the output budget; use a shorter source path",
        );
      return { ok: true, output };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await file?.close();
    }
  },
});
