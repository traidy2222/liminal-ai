import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, open } from "node:fs/promises";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import os from "node:os";
import { AgentEmitter, ToolDispatcher, ToolRegistry } from "@liminal/core";
import { readBinaryTool } from "./read_binary.js";

async function fixture(t: TestContext, bytes = Buffer.alloc(0)) {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-read-binary-"));
  const source = path.join(root, "selected binary.dat");
  await writeFile(source, bytes);
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-read-binary-"));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20,
    });
  });
  return { root, source };
}

test("hex view preserves non-UTF bytes and displays absolute offsets without changing the file", async (t) => {
  const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x41, 0x42, 0x7f, 0x80, 0x20]);
  const { source } = await fixture(t, bytes);
  const result = await readBinaryTool.handler({
    path: source,
    offset: 1,
    length: 6,
  });
  assert(result.ok);
  const value = JSON.parse(result.output);
  assert.equal(value.total_size, bytes.length);
  assert.equal(value.bytes_read, 6);
  assert.equal(value.read_end_offset, 7);
  assert.deepEqual(value.rows, [
    { offset: 1, hex: "fe 00 41 42 7f 80", ascii: "..AB.." },
  ]);
  assert.equal(value.next_offset, 7);
  assert.equal(value.results_truncated, false);
  assert.deepEqual(await readFile(source), bytes);
  assert.equal(readBinaryTool.requiresApproval, false);
});

test("u32le words use the explicit starting offset, retain unsigned values and expose short tails", async (t) => {
  const bytes = Buffer.alloc(14);
  bytes[0] = 0xff;
  bytes.writeUInt32LE(0x12345678, 1);
  bytes.writeUInt32LE(0xffffffff, 5);
  bytes.writeUInt32LE(0x80000000, 9);
  bytes[13] = 0xee;
  const { source } = await fixture(t, bytes);
  const result = await readBinaryTool.handler({
    path: source,
    offset: 1,
    length: 13,
    view: "u32le",
  });
  assert(result.ok);
  const value = JSON.parse(result.output);
  assert.deepEqual(
    value.words.map((word: { offset: number; value: number }) => [
      word.offset,
      word.value,
    ]),
    [
      [1, 0x12345678],
      [5, 0xffffffff],
      [9, 0x80000000],
    ],
  );
  assert.equal(value.words[0].bytes_hex, "78563412");
  assert.deepEqual(value.trailing_bytes, { offset: 13, hex: "ee" });
  assert.equal(value.bytes_read, 13);
  assert.equal(value.next_offset, null);
});

test("ASCII strings retain source offsets and page at the first undisplayed run", async (t) => {
  const { source } = await fixture(
    t,
    Buffer.from([
      0,
      ...Buffer.from("ABCD"),
      0,
      ...Buffer.from("EFGH"),
      0,
      ...Buffer.from("IJKL"),
      255,
    ]),
  );
  const result = await readBinaryTool.handler({
    path: source,
    length: 16,
    view: "strings",
    limit: 2,
  });
  assert(result.ok);
  const value = JSON.parse(result.output);
  assert.deepEqual(
    value.strings.map((run: { offset: number; text: string }) => [
      run.offset,
      run.text,
    ]),
    [
      [1, "ABCD"],
      [6, "EFGH"],
    ],
  );
  assert.equal(value.bytes_read, 16);
  assert.equal(value.next_offset, 11);
  assert.equal(value.results_truncated, true);
  const window = await readBinaryTool.handler({
    path: source,
    offset: 5,
    length: 11,
    view: "strings",
  });
  assert(window.ok);
  const sliced = JSON.parse(window.output);
  assert.deepEqual(
    sliced.strings.map((run: { offset: number; text: string }) => [
      run.offset,
      run.text,
    ]),
    [
      [6, "EFGH"],
      [11, "IJKL"],
    ],
  );
  assert.equal(sliced.next_offset, null);
});

test("render limits bound hex/typed output and continuation resumes undisplayed bytes", async (t) => {
  const { source } = await fixture(t, Buffer.alloc(80, 0x61));
  for (const [view, step] of [
    ["hex", 16],
    ["u32le", 4],
  ] as const) {
    const result = await readBinaryTool.handler({
      path: source,
      length: 80,
      view,
      limit: 1,
    });
    assert(result.ok);
    const value = JSON.parse(result.output);
    assert.equal(value.bytes_read, 80);
    assert.equal(value.read_end_offset, 80);
    assert.equal(value.next_offset, step);
    assert.equal(value.results_truncated, true);
    assert.equal((value.rows ?? value.words).length, 1);
  }
});

test("maximum window remains bounded and long ASCII runs report clipping honestly", async (t) => {
  const { source } = await fixture(t, Buffer.alloc(65537, 0x61));
  const result = await readBinaryTool.handler({
    path: source,
    length: 65536,
    view: "strings",
    limit: 200,
  });
  assert(result.ok);
  const value = JSON.parse(result.output);
  assert.equal(value.bytes_read, 65536);
  assert.equal(value.next_offset, 65536);
  assert.equal(value.strings.length, 1);
  assert.equal(value.strings[0].length, 65536);
  assert.equal(value.strings[0].text.length, 256);
  assert.equal(value.strings[0].text_truncated, true);
  assert.equal(value.strings[0].begins_at_window_boundary, true);
  assert.equal(value.strings[0].ends_at_window_boundary, true);
});

test("EOF clips reads, accepts an empty final window and rejects past-EOF offsets", async (t) => {
  const { source } = await fixture(t, Buffer.from("abc"));
  const result = await readBinaryTool.handler({
    path: source,
    offset: 2,
    length: 256,
  });
  assert(result.ok);
  const value = JSON.parse(result.output);
  assert.equal(value.bytes_read, 1);
  assert.equal(value.next_offset, null);
  assert.equal(value.rows[0].hex, "63");
  const eof = await readBinaryTool.handler({ path: source, offset: 3 });
  assert(eof.ok);
  assert.equal(JSON.parse(eof.output).bytes_read, 0);
  assert.equal(JSON.parse(eof.output).next_offset, null);
  const past = await readBinaryTool.handler({ path: source, offset: 4 });
  assert.equal(past.ok, false);
  if (!past.ok) assert.match(past.error, /past EOF/);
});

test("invalid bounds, unsupported views and directory inputs fail explicitly", async (t) => {
  const { source, root } = await fixture(t, Buffer.from("ABCD"));
  for (const args of [
    { offset: -1 },
    { offset: 0.5 },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { length: 0 },
    { length: 65537 },
    { length: 1.5 },
    { limit: 0 },
    { limit: 201 },
    { min_length: 3 },
    { view: "utf8" },
  ]) {
    const result = await readBinaryTool.handler({ path: source, ...args });
    assert.equal(result.ok, false, JSON.stringify(args));
  }
  const directory = await readBinaryTool.handler({ path: root });
  assert.equal(directory.ok, false);
});

test("a large sparse source is read with bounded positional FileHandle reads", async (t) => {
  const { source } = await fixture(t);
  const far = 64 * 1024 * 1024 + 17;
  const writer = await open(source, "r+");
  try {
    await writer.write(Buffer.from([0xde, 0xad, 0xbe, 0xef]), 0, 4, far);
  } finally {
    await writer.close();
  }
  const actualOpen = fs.promises.open,
    requests: Array<{ length: number; position: number }> = [];
  let reader: Awaited<ReturnType<typeof open>> | undefined;
  t.mock.method(fs.promises, "open", async (...args: unknown[]) => {
    const file = await (actualOpen as any)(...args);
    if (args[0] === source) {
      reader = file;
      const actualRead = file.read.bind(file);
      t.mock.method(file, "read", async (...readArgs: any[]) => {
        const options = Buffer.isBuffer(readArgs[0])
          ? { length: readArgs[2], position: readArgs[3] }
          : readArgs[0];
        requests.push({ length: options.length, position: options.position });
        return actualRead(...readArgs);
      });
    }
    return file;
  });
  syncBuiltinESMExports();
  try {
    const result = await readBinaryTool.handler({
      path: source,
      offset: far - 2,
      length: 8,
    });
    assert(result.ok);
    const value = JSON.parse(result.output);
    assert.equal(value.total_size, far + 4);
    assert.equal(value.bytes_read, 6);
    assert.equal(value.rows[0].hex, "00 00 de ad be ef");
    assert.equal(value.next_offset, null);
    assert(requests.length > 0);
    assert(
      requests.every(
        (request) => request.length <= 8 && request.position >= far - 2,
      ),
    );
    assert.equal(reader?.fd, -1, "reader handle closes after the observation");
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("pre-abort and cancellation during a nonthrowing read return no successful observation and close the handle", async (t) => {
  const { source } = await fixture(t, Buffer.from("ABCD"));
  const before = new AbortController();
  before.abort();
  const preAborted = await readBinaryTool.handler(
    { path: source },
    undefined,
    undefined,
    { signal: before.signal },
  );
  assert.equal(preAborted.ok, false);
  const during = new AbortController(),
    actualOpen = fs.promises.open;
  let reader: Awaited<ReturnType<typeof open>> | undefined;
  t.mock.method(fs.promises, "open", async (...args: unknown[]) => {
    const file = await (actualOpen as any)(...args);
    if (args[0] === source) {
      reader = file;
      const actualRead = file.read.bind(file);
      t.mock.method(file, "read", async (...readArgs: unknown[]) => {
        const result = await actualRead(...readArgs);
        during.abort();
        return result;
      });
    }
    return file;
  });
  syncBuiltinESMExports();
  try {
    const result = await readBinaryTool.handler(
      { path: source },
      undefined,
      undefined,
      { signal: during.signal },
    );
    assert.equal(result.ok, false);
    assert.equal(reader?.fd, -1);
    assert.deepEqual(await readFile(source), Buffer.from("ABCD"));
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("escaped long ASCII runs remain valid bounded JSON through dispatch and paginate without losing a run", async (t) => {
  const runs = Array.from({ length: 200 }, (_, i) =>
    Buffer.from(
      `${String(i).padStart(3, "0")}:` +
        String.fromCharCode(92, 34).repeat(126),
      "ascii",
    ),
  );
  assert(runs.every((run) => run.length === 256));
  const { source } = await fixture(
    t,
    Buffer.concat(runs.flatMap((run) => [run, Buffer.from([0])])),
  );
  const registry = new ToolRegistry(),
    emitter = new AgentEmitter();
  registry.register(readBinaryTool);
  registry.activate(["read_binary"]);
  const dispatcher = new ToolDispatcher(registry, emitter);
  const seen: number[] = [];
  let offset = 0,
    pages = 0;
  for (;;) {
    const result = await dispatcher.dispatch(
      `escaped-page-${pages}`,
      "read_binary",
      JSON.stringify({
        path: source,
        offset,
        length: 65536,
        view: "strings",
        limit: 200,
      }),
    );
    assert(result.ok);
    assert(
      Buffer.byteLength(result.output, "utf8") <= 24000,
      "serialized observations must fit below the dispatcher truncation cap",
    );
    assert.doesNotMatch(result.output, /OUTPUT TRUNCATED/);
    const value = JSON.parse(result.output);
    assert(value.strings.length > 0 && value.strings.length <= 200);
    for (const run of value.strings) {
      const index = seen.length;
      assert.equal(run.offset, index * 257);
      assert.equal(run.text, runs[index]!.toString("ascii"));
      assert.equal(run.length, 256);
      assert.equal(run.text_truncated, false);
      seen.push(run.offset);
    }
    pages++;
    if (value.next_offset === null) break;
    assert(value.next_offset > offset);
    assert.equal(
      value.next_offset,
      seen.length * 257,
      "next_offset must point to the first omitted string, not the read window end",
    );
    assert.equal(value.results_truncated, true);
    offset = value.next_offset;
    assert(pages < 20, "bounded observations must still make forward progress");
  }
  assert.equal(seen.length, 200);
  assert(pages > 1);
});
