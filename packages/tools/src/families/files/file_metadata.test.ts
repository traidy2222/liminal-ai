import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import fs from "node:fs";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { runWithWorkspaceRoot } from "@liminal/core";
import { fileMetadataTool } from "./file_metadata.js";

async function fixture(t: TestContext, action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-file-metadata-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-file-metadata-"));
    await rm(root, { recursive: true, force: true });
  });
  await runWithWorkspaceRoot(root, () => action(root));
}

async function metadata(file: string, includeHash = true): Promise<Record<string, unknown>> {
  const result = await fileMetadataTool.handler({ path: file, include_hash: includeHash });
  assert(result.ok, result.ok ? undefined : result.error);
  return JSON.parse(result.output) as Record<string, unknown>;
}

test("binary metadata hashes raw non-UTF8 bytes without inventing a text line count", async (t) => {
  await fixture(t, async (root) => {
    const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0xff, 0xc3, 0x28, 0x00, 0x0a]);
    const file = path.join(root, "game.elf");
    await writeFile(file, bytes);
    const out = await metadata(file);
    assert.equal(out.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
    assert.equal(out.size_bytes, bytes.length);
    assert.equal(out.line_count, null);
    assert.match(String(out.line_count_note), /binary|utf-?8/i);
    assert.equal(out.header_hex, bytes.toString("hex"));
    assert.equal(out.detected_format, "elf");
  });
});

test("small UTF8 text keeps the existing LF/CRLF and empty-line counting semantics", async (t) => {
  await fixture(t, async (root) => {
    const file = path.join(root, "notes.txt");
    for (const content of ["", "one", "one\n", "one\r\ntwo\r\n", "日本語\nnotes"]) {
      await writeFile(file, content);
      const out = await metadata(file);
      assert.equal(out.line_count, content.split(/\r?\n/).length, content);
      assert.equal(out.sha256, crypto.createHash("sha256").update(content).digest("hex"));
    }
  });
});

test("directory metadata does not try to read or hash directory bytes", async (t) => {
  await fixture(t, async (root) => {
    const out = await metadata(root);
    assert.equal(out.kind, "directory");
    assert.equal(out.line_count, null);
    assert.equal(out.sha256, null);
    assert.match(String(out.line_count_note), /not applicable|directory/i);
  });
});

test("hash-off metadata reads only a bounded prefix of a large sparse file", async (t) => {
  await fixture(t, async (root) => {
    const file = path.join(root, "large.iso");
    const handle = await open(file, "w");
    const size = 128 * 1024 * 1024;
    await handle.truncate(size);
    await handle.write(Buffer.from("\x01CD001\x01", "ascii"), 0, 7, 0x8000);
    await handle.close();

    const originalReadFile = fs.promises.readFile;
    const originalOpen = fs.promises.open;
    const originalStream = fs.createReadStream;
    let bytesRead = 0;
    fs.promises.readFile = async () => { throw new Error("Unbounded readFile is forbidden for metadata"); };
    fs.createReadStream = (() => { throw new Error("Hash-off metadata must not stream the complete file"); }) as typeof fs.createReadStream;
    fs.promises.open = (async (...args: Parameters<typeof fs.promises.open>) => {
      const opened = await originalOpen(...args);
      const read = opened.read.bind(opened);
      opened.read = (async (...readArgs: Parameters<typeof opened.read>) => {
        const result = await read(...readArgs);
        bytesRead += result.bytesRead;
        return result;
      }) as typeof opened.read;
      return opened;
    }) as typeof fs.promises.open;
    syncBuiltinESMExports();
    try {
      const out = await metadata(file, false);
      assert.equal(out.size_bytes, size);
      assert.equal(out.line_count, null);
      assert.match(String(out.line_count_note), /large|limit|bound/i);
      assert.equal("sha256" in out, false);
      assert.equal(out.detected_format, "iso9660");
      assert(bytesRead > 0 && bytesRead <= 64 * 1024, `Unexpected read budget: ${bytesRead}`);
    } finally {
      fs.promises.readFile = originalReadFile;
      fs.promises.open = originalOpen;
      fs.createReadStream = originalStream;
      syncBuiltinESMExports();
    }
  });
});

test("large text has an explicit uncounted line total while its raw-byte hash remains exact", async (t) => {
  await fixture(t, async (root) => {
    const bytes = Buffer.from("fixture line\n".repeat(100_000));
    const file = path.join(root, "large.txt");
    await writeFile(file, bytes);
    const out = await metadata(file);
    assert.equal(out.line_count, null);
    assert.match(String(out.line_count_note), /large|limit|bound/i);
    assert.equal(out.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  });
});

test("metadata returns readable missing-file and invalid-path errors", async (t) => {
  await fixture(t, async (root) => {
    for (const file of ["", path.join(root, "missing.bin")]) {
      const result = await fileMetadataTool.handler({ path: file });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /empty path|ENOENT|not found/i);
    }
  });
});
