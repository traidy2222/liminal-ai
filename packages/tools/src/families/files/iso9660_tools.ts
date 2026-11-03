import path from "node:path";
import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { resolveWorkspaceRoot, type NativeBinaryHeaderObservation } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  isPathInsideWorkspaceRoot,
  resolveWithinWorkspace,
} from "../../shared/file_path_guard.js";
import { Iso9660Image, observeDiscFileHeader, type Iso9660Entry } from "./iso9660.js";

const COVERAGE =
  "ISO9660 primary namespace only. UDF, Joliet and Rock Ridge names/metadata are not decoded. Multi-extent, interleaved and extended-attribute files are unsupported. No target execution or whole-image hashing.";

async function observeMemberHeader(image: Iso9660Image, member: Iso9660Entry, header?: Buffer): Promise<Record<string, unknown>> {
  const observations = observeDiscFileHeader(
    header ?? await image.read(member.offset, Math.min(member.size, 4096)),
    member.size,
  );
  const native = observations.native_header as NativeBinaryHeaderObservation | undefined;
  const entry = native?.entry;
  if (entry?.mapping_status === "mapped" && entry.file_offset !== null) {
    const offset = entry.file_offset, count = entry.entry_bytes_length;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(count) ||
        count === undefined || count < 1 || count > 16 || offset > member.size || count > member.size - offset)
      throw new Error("Native entry observation exceeds the selected ISO member extent");
    const bytes = await image.read(member.offset + offset, count);
    entry.bytes_hex = bytes.toString("hex");
    observations.mapped_entry_bytes = {
      file_offset: offset, iso_source_offset: member.offset + offset, length: bytes.length,
      hex: entry.bytes_hex,
      coverage: "Measured file-backed bytes at the uniquely mapped native entry within this exact ISO member. No instruction decoding or target execution.",
    };
  }
  return observations;
}

function integer(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    throw new Error(`Expected an integer from 0 to ${max}`);
  return value;
}

export async function prepareDestination(input: string): Promise<string> {
  if (!input.trim()) throw new Error("A new destination path is required");
  const root = path.resolve(resolveWorkspaceRoot());
  const canonicalRoot = await realpath(root);
  const destination = path.resolve(root, input);
  if (destination === root || !isPathInsideWorkspaceRoot(destination, root))
    throw new Error(
      "Extraction destination must be a new file inside the workspace",
    );
  for (const part of path.relative(root, destination).split(path.sep)) {
    if (
      /[<>:"|?*\\\x00-\x1f]/.test(part) ||
      /[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    ) {
      throw new Error(
        "Extraction destination contains an unsafe or reserved filename",
      );
    }
  }
  const pending: string[] = [];
  let parent = path.dirname(destination);
  for (;;) {
    try {
      const stat = await lstat(parent);
      if (!stat.isDirectory() && !stat.isSymbolicLink())
        throw new Error("Extraction destination parent is not a directory");
      const canonical = await realpath(parent);
      if (!isPathInsideWorkspaceRoot(canonical, canonicalRoot))
        throw new Error(
          "Extraction destination escapes workspace through a symbolic link",
        );
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Existing dangling links are not new directories.
      try {
        if ((await lstat(parent)).isSymbolicLink())
          throw new Error("Dangling destination-parent symbolic link");
      } catch (linkError) {
        if ((linkError as NodeJS.ErrnoException).code !== "ENOENT")
          throw linkError;
      }
      pending.push(path.basename(parent));
      const next = path.dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
  for (const part of pending.reverse()) {
    parent = path.join(parent, part);
    try {
      await mkdir(parent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    // Another approved extraction may have created this directory after our
    // initial walk. Accept that race only after checking the actual object and
    // canonical workspace boundary again; never accept a replacement link/file.
    if (!(await lstat(parent)).isDirectory())
      throw new Error("Extraction destination parent is not a directory");
    if (!isPathInsideWorkspaceRoot(await realpath(parent), canonicalRoot))
      throw new Error("Extraction destination directory escaped workspace");
  }
  const canonicalParent = await realpath(path.dirname(destination));
  if (!isPathInsideWorkspaceRoot(canonicalParent, canonicalRoot))
    throw new Error("Extraction destination escapes workspace");
  return path.join(canonicalParent, path.basename(destination));
}

export const inspectDiscImageTool = defineTool({
  name: "inspect_disc_image",
  description:
    "Inspect an ISO9660 disc image without mounting or executing it. Return a paginated/filterable primary-namespace inventory, exact member offsets/sizes, bounded selected-file headers and SYSTEM.CNF when present. Use before writing custom ISO parsers or attempting REA on an ISO. UDF-only and raw-sector BIN images are unsupported; Joliet/Rock Ridge are not decoded.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to the selected ISO image." },
      search: {
        type: "string",
        description:
          "Optional case-insensitive path substring; e.g. .EXE, SYSTEM.CNF or FUTURAMA.IMG.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        description: "Offset in matching entries, default 0.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 200,
        description: "Matching entries per page, default 50, maximum 200.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  handler: async (args, _emit, _harness, context) => {
    let image: Iso9660Image | undefined;
    try {
      const safe = resolveWithinWorkspace(String(args.path ?? ""));
      if (!safe.ok || !safe.resolvedPath)
        throw new Error(safe.error ?? "Invalid disc image path");
      const offset = integer(args.offset, 0, 50_000),
        limit = integer(args.limit, 50, 200);
      if (limit === 0) throw new Error("limit must be at least 1");
      image = await Iso9660Image.open(safe.resolvedPath, context?.signal);
      const search = String(args.search ?? "").toLowerCase();
      const matching = image.entries.filter((entry) =>
        entry.path.toLowerCase().includes(search),
      );
      const page = [];
      for (const entry of matching.slice(offset, offset + limit)) {
        page.push(
          entry.kind === "file"
            ? {
                ...entry,
                observations: await observeMemberHeader(image, entry),
              }
            : entry,
        );
      }
      const config = image.entries.find(
        (entry) =>
          entry.path.toUpperCase() === "/SYSTEM.CNF" &&
          entry.kind === "file" &&
          entry.size <= 4096,
      );
      const boot_config = config
        ? {
            member_path: config.path,
            source_offset: config.offset,
            size: config.size,
            text: (await image.read(config.offset, config.size)).toString(
              "utf8",
            ),
          }
        : undefined;
      await image.assertUnchanged();
      return {
        ok: true,
        output: JSON.stringify(
          {
            source: image.path,
            source_size: image.sourceSize,
            volume_id: image.volumeId,
            namespace: "ISO9660 primary",
            coverage: COVERAGE,
            entry_count: image.entries.length + image.issues.length,
            available_entry_count: image.entries.length,
            inventory_complete: image.issues.length === 0,
            issue_count: image.issues.length,
            issues: image.issues.slice(0, 50),
            matched_count: matching.length,
            offset,
            next_offset:
              offset + page.length < matching.length
                ? offset + page.length
                : null,
            entries: page,
            boot_config,
            bytes_read: image.bytesRead,
          },
          null,
          2,
        ),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await image?.close();
    }
  },
});

export const extractDiscFileTool = defineTool({
  name: "extract_disc_file",
  description:
    "Extract exactly one selected ISO9660 file to a NEW caller-selected workspace path, streaming its validated extent and returning SHA-256 and bounded format observations. Never overwrite files, mount a disc, execute a target, or alter the source image. Use the exact member_path returned by inspect_disc_image; primary namespace only.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Source ISO image path." },
      member_path: {
        type: "string",
        description:
          "Exact primary-namespace member path from inspect_disc_image, e.g. /SLUS_213.06.",
      },
      destination: {
        type: "string",
        description:
          "New output file path inside the active workspace; existing files are rejected.",
      },
    },
    required: ["path", "member_path", "destination"],
    additionalProperties: false,
  },
  handler: async (args, emit, _harness, context) => {
    let image: Iso9660Image | undefined;
    let output: Awaited<ReturnType<typeof open>> | undefined;
    let destination: string | undefined;
    let created: { dev: number; ino: number } | undefined;
    let complete = false;
    try {
      const safe = resolveWithinWorkspace(String(args.path ?? ""));
      if (!safe.ok || !safe.resolvedPath)
        throw new Error(safe.error ?? "Invalid disc image path");
      image = await Iso9660Image.open(safe.resolvedPath, context?.signal);
      const requested = String(args.member_path ?? "");
      const member = image.entries.find(
        (entry) =>
          entry.path === requested ||
          entry.path.slice(0, entry.path.lastIndexOf("/") + 1) +
            entry.identifier ===
            requested,
      );
      const unavailable = image.issues.find(
        (issue) => issue.path === requested,
      );
      if (unavailable)
        throw new Error(
          `Selected ISO9660 member is unavailable: ${unavailable.error}`,
        );
      if (!member || member.kind !== "file")
        throw new Error(
          "Exact file member not found; use member_path from inspect_disc_image",
        );
      destination = await prepareDestination(String(args.destination ?? ""));
      context?.signal?.throwIfAborted();
      output = await open(destination, "wx");
      const stat = await output.stat();
      created = { dev: stat.dev, ino: stat.ino };
      const hash = createHash("sha256");
      let done = 0;
      let header: Buffer = Buffer.alloc(0);
      emit?.(`Extracting ${member.path} (${member.size} bytes)`);
      while (done < member.size) {
        context?.signal?.throwIfAborted();
        const chunk = await image.read(
          member.offset + done,
          Math.min(1024 * 1024, member.size - done),
        );
        if (done === 0) header = chunk.subarray(0, 4096);
        hash.update(chunk);
        for (let written = 0; written < chunk.length; ) {
          context?.signal?.throwIfAborted();
          const result = await output.write(
            chunk,
            written,
            chunk.length - written,
          );
          if (result.bytesWritten === 0)
            throw new Error("Could not write extracted file");
          written += result.bytesWritten;
        }
        done += chunk.length;
      }
      const observations = await observeMemberHeader(image, member, header);
      await image.assertUnchanged();
      await output.sync();
      complete = true;
      return {
        ok: true,
        output: JSON.stringify(
          {
            source: image.path,
            namespace: "ISO9660 primary",
            coverage: COVERAGE,
            member_path: member.path,
            source_offset: member.offset,
            size: done,
            destination,
            sha256: hash.digest("hex"),
            observations,
          },
          null,
          2,
        ),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await output?.close();
      await image?.close();
      if (!complete && created && destination) {
        const current = await lstat(destination).catch(() => undefined);
        if (
          current &&
          !current.isSymbolicLink() &&
          current.dev === created.dev &&
          current.ino === created.ino
        )
          await unlink(destination).catch(() => undefined);
      }
    }
  },
});
