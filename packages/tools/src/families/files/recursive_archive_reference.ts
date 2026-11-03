/** Standalone reference implementation of the explicitly selected observed
 * profile. It needs only Python's standard library, never imports Liminal,
 * never executes payloads, and never writes to the source or other files.
 */
export const RECURSIVE_ARCHIVE_PYTHON_REFERENCE = String.raw`#!/usr/bin/env python3
"""Read-only reference parser for recursive_name_table_v1.

This explicitly selected profile has no magic/version signature. Do not infer
it from a filename extension. It validates the complete index and file extents,
not payload semantics, models, skeletons or animations.

Usage: python parser.py SOURCE [--summary]
Default stdout: complete JSON inventory. --summary: compact validation counts.
No extraction, target execution, dependency installation or output-file writes.
"""
import argparse
import hashlib
import json
import os
import stat
import struct
import sys

PROFILE = "recursive_name_table_v1"
MAX_INDEX = 16 * 1024 * 1024
MAX_RECORDS = 50000
MAX_DEPTH = 32
MAX_PATH_CHARACTERS = 16 * 1024 * 1024


def parse_archive(source):
    descriptor = os.open(source, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(descriptor, "rb") as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size < 4:
            raise ValueError("Source must be an ordinary file with an index boundary")
        before_path = os.stat(source)
        if (not os.path.samestat(before, before_path)
                or before.st_size != before_path.st_size
                or before.st_mtime_ns != before_path.st_mtime_ns):
            raise ValueError("Source changed during inspection")
        header = handle.read(4)
        if len(header) != 4:
            raise ValueError("Missing index boundary")
        index_end = struct.unpack("<I", header)[0]
        if index_end < 4 or index_end % 4 or index_end > min(before.st_size, MAX_INDEX):
            raise ValueError("Invalid index boundary (maximum 16 MiB)")
        handle.seek(0)
        index = handle.read(index_end)
        if len(index) != index_end:
            raise ValueError("Truncated index")
        entries = []
        seen = set()
        stack = []
        position = 4
        path_characters = 0
        max_depth = 0
        while position < index_end:
            while stack and position == stack[-1][0]:
                stack.pop()
            boundary = stack[-1][0] if stack else index_end
            if position > boundary:
                raise ValueError("Record crosses a directory boundary")
            if len(entries) >= MAX_RECORDS:
                raise ValueError("Record count exceeds 50000")
            is_directory = bool(index[position] & 0x80)
            name_end = index.find(b"\0", position, min(boundary, position + 257))
            if name_end < position:
                raise ValueError("Missing bounded member-name terminator")
            encoded = bytearray(index[position:name_end])
            if not encoded:
                raise ValueError("Empty member name")
            encoded[0] &= 0x7f
            if any(value < 32 or value > 126 for value in encoded):
                raise ValueError("Unsupported name encoding")
            name = encoded.decode("ascii")
            if name in (".", "..") or any(char in name for char in "/\\:"):
                raise ValueError("Unsafe member name")
            member_path = "/".join([item[1] for item in stack] + [name])
            path_characters += len(member_path)
            if len(member_path) > 4096 or path_characters > MAX_PATH_CHARACTERS:
                raise ValueError("Path resource limit exceeded")
            if member_path in seen:
                raise ValueError("Duplicate member path")
            seen.add(member_path)
            metadata = (name_end + 4) & ~3
            record_end = metadata + (4 if is_directory else 8)
            if record_end > boundary:
                raise ValueError("Record fields cross a directory/index boundary")
            if any(index[name_end:metadata]):
                raise ValueError("Nonzero name padding")
            entry = {"path": member_path, "identifier": name,
                     "kind": "directory" if is_directory else "file",
                     "record_offset": position, "metadata_offset": metadata,
                     "record_end": record_end}
            if is_directory:
                span = struct.unpack_from("<I", index, metadata)[0]
                directory_end = metadata + span
                if span < 4 or span % 4 or directory_end > boundary:
                    raise ValueError("Invalid directory span")
                if len(stack) + 1 > MAX_DEPTH:
                    raise ValueError("Directory depth exceeds 32")
                entry["directory_end"] = directory_end
                entries.append(entry)
                stack.append((directory_end, name))
                max_depth = max(max_depth, len(stack))
                position = record_end
            else:
                size, offset = struct.unpack_from("<II", index, metadata)
                if offset < index_end or offset % 2048 or offset + size > before.st_size:
                    raise ValueError("Invalid, unaligned or out-of-bounds file extent")
                entry.update(size=size, offset=offset)
                entries.append(entry)
                position = record_end
        while stack and position == stack[-1][0]:
            stack.pop()
        if stack or position != index_end:
            raise ValueError("Index/directory scopes were not consumed exactly")
        files = [entry for entry in entries if entry["kind"] == "file"]
        extents = sorted((entry for entry in files if entry["size"]),
                         key=lambda entry: entry["offset"])
        for previous, current in zip(extents, extents[1:]):
            if previous["offset"] + previous["size"] > current["offset"]:
                raise ValueError("Payload extents overlap")
        def identity(value):
            return (value.st_dev, value.st_ino, value.st_size,
                    value.st_mtime_ns, value.st_ctime_ns)
        # Newer Windows Python versions use different st_ctime conventions in
        # stat and fstat. Compare each channel with its own initial observation;
        # samestat above still binds the opened file to the selected pathname.
        if (identity(before) != identity(os.fstat(handle.fileno()))
                or identity(before_path) != identity(os.stat(source))):
            raise ValueError("Source changed during inspection")
        return {"format": PROFILE, "source": os.path.abspath(source),
                "source_size": before.st_size, "index_end": index_end,
                "index_sha256": hashlib.sha256(index).hexdigest(),
                "record_count": len(entries), "file_count": len(files),
                "directory_count": len(entries) - len(files), "max_depth": max_depth,
                "validation": {"index_consumed_exactly": True,
                    "file_extents_in_bounds": True,
                    "file_extents_sector_aligned": True,
                    "file_extents_nonoverlapping": True},
                "limitations": ["Explicit observed profile, not magic-based format detection.",
                    "Payload content and model/skeleton/animation structures are not decoded."],
                "entries": entries}


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("source", help="Selected archive path (opened read-only)")
    arguments.add_argument("--summary", action="store_true", help="Omit member entries from stdout")
    options = arguments.parse_args()
    try:
        result = parse_archive(options.source)
        if options.summary:
            del result["entries"]
        json.dump(result, sys.stdout, ensure_ascii=True)
        sys.stdout.write("\n")
    except (OSError, ValueError) as error:
        print(PROFILE + ": " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;
