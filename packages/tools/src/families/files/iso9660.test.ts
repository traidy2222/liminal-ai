import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { runWithWorkspaceRoot } from "@liminal/core";
import { Iso9660Image } from "./iso9660.js";
import { inspectDiscImageTool, extractDiscFileTool } from "./iso9660_tools.js";

const SECTOR = 2048;
function both16(bytes: Buffer, offset: number, value: number) {
  bytes.writeUInt16LE(value, offset);
  bytes.writeUInt16BE(value, offset + 2);
}
function both32(bytes: Buffer, offset: number, value: number) {
  bytes.writeUInt32LE(value, offset);
  bytes.writeUInt32BE(value, offset + 4);
}
function record(
  name: string | number,
  lba: number,
  size: number,
  directory = false,
): Buffer {
  const identifier =
    typeof name === "number" ? Buffer.from([name]) : Buffer.from(name, "ascii");
  const row = Buffer.alloc(
    33 + identifier.length + (identifier.length % 2 === 0 ? 1 : 0),
  );
  row[0] = row.length;
  both32(row, 2, lba);
  both32(row, 10, size);
  row[25] = directory ? 2 : 0;
  both16(row, 28, 1);
  row[32] = identifier.length;
  identifier.copy(row, 33);
  return row;
}

function fixture(payload = Buffer.from("exact selected bytes\n")): Buffer {
  const blocks = Math.max(36, 24 + Math.ceil(payload.length / SECTOR));
  const image = Buffer.alloc(blocks * SECTOR);
  const primary = image.subarray(16 * SECTOR, 17 * SECTOR);
  primary[0] = 1;
  primary.write("CD001", 1);
  primary[6] = 1;
  primary.write("TEST_GAME", 40);
  both32(primary, 80, blocks);
  both16(primary, 120, 1);
  both16(primary, 124, 1);
  both16(primary, 128, SECTOR);
  record(0, 20, SECTOR, true).copy(primary, 156);
  const terminator = image.subarray(17 * SECTOR, 18 * SECTOR);
  terminator[0] = 255;
  terminator.write("CD001", 1);
  terminator[6] = 1;
  const cnf = Buffer.from("BOOT2 = cdrom0:\\SLUS_123.45;1\r\n");
  const root = Buffer.concat([
    record(0, 20, SECTOR, true),
    record(1, 20, SECTOR, true),
    record("SYSTEM.CNF;1", 22, cnf.length),
    record("ASSETS", 21, SECTOR, true),
    record("SLUS_123.45;1", 23, 64),
  ]);
  root.copy(image, 20 * SECTOR);
  Buffer.concat([
    record(0, 21, SECTOR, true),
    record(1, 20, SECTOR, true),
    record("PAYLOAD.BIN;1", 24, payload.length),
  ]).copy(image, 21 * SECTOR);
  cnf.copy(image, 22 * SECTOR);
  const elf = image.subarray(23 * SECTOR, 23 * SECTOR + 64);
  elf.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1]);
  elf.writeUInt16LE(8, 18);
  elf.writeUInt32LE(0x100008, 24);
  payload.copy(image, 24 * SECTOR);
  return image;
}

async function setup(
  t: { after: (cleanup: () => Promise<void>) => void },
  data = fixture(),
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-iso-test-"));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  const source = path.join(root, "game.iso");
  await writeFile(source, data);
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-iso-test-"));
    await rm(root, { recursive: true, force: true });
  });
  return { root, workspace, source };
}

test("primary ISO inventory reads bounded metadata and preserves boot/header evidence", async (t) => {
  const { source, workspace } = await setup(t);
  const image = await Iso9660Image.open(source);
  try {
    assert.equal(image.volumeId.replace(/\0/g, ""), "TEST_GAME");
    assert.deepEqual(
      image.entries.map((e) => e.path),
      ["/SYSTEM.CNF", "/ASSETS", "/SLUS_123.45", "/ASSETS/PAYLOAD.BIN"],
    );
    assert.equal(image.entries.at(-1)?.offset, 24 * SECTOR);
    assert.equal(image.bytesRead, 4 * SECTOR);
    await assert.rejects(image.read(0, 2 * 1024 * 1024), /bounded chunk/);
  } finally {
    await image.close();
  }
  const reply = await runWithWorkspaceRoot(workspace, () =>
    inspectDiscImageTool.handler({ path: source, search: "SLUS", limit: 1 }),
  );
  assert(reply.ok);
  const output = JSON.parse(reply.output);
  assert.equal(output.namespace, "ISO9660 primary");
  assert.match(output.coverage, /Joliet.*not decoded/);
  assert.equal(output.entries[0].path, "/SLUS_123.45");
  assert.equal(output.entries[0].observations.machine, 8);
  assert.equal(output.entries[0].observations.entry, "0x100008");
  assert.match(output.boot_config.text, /BOOT2.*SLUS_123.45/);
  assert.equal(output.next_offset, null);
  assert(output.bytes_read < 16_384);
});

test("inventory pagination filters paths without reporting nonexistent namespaces", async (t) => {
  const { source, workspace } = await setup(t);
  const reply = await runWithWorkspaceRoot(workspace, () =>
    inspectDiscImageTool.handler({ path: source, offset: 1, limit: 2 }),
  );
  assert(reply.ok);
  const output = JSON.parse(reply.output);
  assert.equal(output.matched_count, 4);
  assert.equal(output.next_offset, 3);
  assert.deepEqual(
    output.entries.map((e: { path: string }) => e.path),
    ["/ASSETS", "/SLUS_123.45"],
  );
});

test("streamed extraction hashes exact chosen bytes and rejects overwrites", async (t) => {
  const payload = Buffer.alloc(3 * 1024 * 1024 + 17, 0xa7);
  payload.write("bounded stream");
  const data = fixture(payload),
    { source, workspace } = await setup(t, data);
  const originalHash = createHash("sha256").update(data).digest("hex");
  const destination = path.join(workspace, "output", "asset.bin");
  const reply = await runWithWorkspaceRoot(workspace, () =>
    extractDiscFileTool.handler({
      path: source,
      member_path: "/ASSETS/PAYLOAD.BIN",
      destination,
    }),
  );
  assert(reply.ok);
  const output = JSON.parse(reply.output);
  assert.equal(output.size, payload.length);
  assert.equal(output.source_offset, 24 * SECTOR);
  assert.equal(
    output.sha256,
    createHash("sha256").update(payload).digest("hex"),
  );
  assert.deepEqual(await readFile(destination), payload);
  const duplicate = await runWithWorkspaceRoot(workspace, () =>
    extractDiscFileTool.handler({
      path: source,
      member_path: "/ASSETS/PAYLOAD.BIN",
      destination,
    }),
  );
  assert.equal(duplicate.ok, false);
  assert.equal((await stat(destination)).size, payload.length);
  assert.equal(
    createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
    originalHash,
  );
  assert.equal(inspectDiscImageTool.requiresApproval, false);
  assert.equal(extractDiscFileTool.requiresApproval, true);
});

test("extraction rejects external destinations and symlink-parent escapes even without workspace-bound mode", async (t) => {
  const { source, root, workspace } = await setup(t);
  const outside = path.join(root, "outside");
  await mkdir(outside);
  const direct = await runWithWorkspaceRoot(workspace, () =>
    extractDiscFileTool.handler({
      path: source,
      member_path: "/ASSETS/PAYLOAD.BIN",
      destination: path.join(outside, "direct.bin"),
    }),
  );
  assert.equal(direct.ok, false);
  await symlink(
    outside,
    path.join(workspace, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const linked = await runWithWorkspaceRoot(workspace, () =>
    extractDiscFileTool.handler({
      path: source,
      member_path: "/ASSETS/PAYLOAD.BIN",
      destination: "link/escaped.bin",
    }),
  );
  assert.equal(linked.ok, false);
  await assert.rejects(stat(path.join(outside, "escaped.bin")), {
    code: "ENOENT",
  });
});

test("extraction accepts the exact on-disc versioned identifier from BOOT2 without guessing other versions", async (t) => {
  const { source, workspace } = await setup(t);
  const reply = await runWithWorkspaceRoot(workspace, () =>
    extractDiscFileTool.handler({
      path: source,
      member_path: "/SLUS_123.45;1",
      destination: "boot.elf",
    }),
  );
  assert(reply.ok);
  assert.equal(JSON.parse(reply.output).member_path, "/SLUS_123.45");
  assert.equal((await readFile(path.join(workspace, "boot.elf"))).length, 64);
  const wrong = await runWithWorkspaceRoot(workspace, () =>
    extractDiscFileTool.handler({
      path: source,
      member_path: "/SLUS_123.45;2",
      destination: "wrong.elf",
    }),
  );
  assert.equal(wrong.ok, false);
});

test("cancelled extraction removes only its own partial output", async (t) => {
  const { source, workspace } = await setup(t),
    controller = new AbortController();
  const destination = path.join(workspace, "cancelled.bin");
  const reply = await runWithWorkspaceRoot(workspace, () =>
    extractDiscFileTool.handler(
      { path: source, member_path: "/ASSETS/PAYLOAD.BIN", destination },
      () => controller.abort(),
      undefined,
      { signal: controller.signal },
    ),
  );
  assert.equal(reply.ok, false);
  await assert.rejects(stat(destination), { code: "ENOENT" });
});

test(
  "parallel extractions share a new output directory without racing mkdir",
  { timeout: 5000 },
  async (t) => {
    const data = fixture(),
      { source, workspace } = await setup(t, data);
    const before = createHash("sha256").update(data).digest("hex");
    const sharedParent = path.join(workspace, "extracted");
    const actualMkdir = fs.promises.mkdir;
    let arrivals = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.signal.addEventListener("abort", () => release(), { once: true });
    // Hold both real mkdir calls until both extractions observed the absent
    // directory. This deterministically reproduces the live filesystem race.
    t.mock.method(
      fs.promises,
      "mkdir",
      async (target: string, ...options: unknown[]) => {
        if (target === sharedParent) {
          if (++arrivals === 2) release();
          await barrier;
        }
        return (actualMkdir as any)(target, ...options);
      },
    );
    syncBuiltinESMExports();
    let replies;
    try {
      replies = await runWithWorkspaceRoot(workspace, () =>
        Promise.all([
          extractDiscFileTool.handler({
            path: source,
            member_path: "/SLUS_123.45;1",
            destination: "extracted/boot.elf",
          }),
          extractDiscFileTool.handler({
            path: source,
            member_path: "/ASSETS/PAYLOAD.BIN",
            destination: "extracted/payload.bin",
          }),
        ]),
      );
    } finally {
      release();
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
    assert.equal(arrivals, 2);
    assert(
      replies.every((reply) => reply.ok),
      `both approved file extractions must succeed: ${replies.map((reply) => (reply.ok ? "ok" : reply.error)).join("; ")}`,
    );
    for (const reply of replies) {
      assert(reply.ok);
      const output = JSON.parse(reply.output);
      const bytes = await readFile(output.destination);
      assert.equal(
        output.sha256,
        createHash("sha256").update(bytes).digest("hex"),
      );
      const expected =
        output.member_path === "/SLUS_123.45"
          ? data.subarray(23 * SECTOR, 23 * SECTOR + 64)
          : Buffer.from("exact selected bytes\n");
      assert.deepEqual(bytes, expected);
    }
    assert.equal(
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex"),
      before,
    );
  },
);

test("extraction refuses alternate data streams and reserved device filenames", async (t) => {
  const { source, workspace } = await setup(t);
  for (const destination of [
    "file.bin:stream",
    "CON",
    "NUL.txt",
    "ambiguous. ",
  ]) {
    const reply = await runWithWorkspaceRoot(workspace, () =>
      extractDiscFileTool.handler({
        path: source,
        member_path: "/ASSETS/PAYLOAD.BIN",
        destination,
      }),
    );
    assert.equal(reply.ok, false);
    if (!reply.ok) assert.match(reply.error, /unsafe or reserved/);
  }
});

for (const [name, mutate, expected] of [
  [
    "wrong identifier length offset",
    (b: Buffer) => {
      b[20 * SECTOR + 68 + 32] = 255;
    },
    /Malformed/,
  ],
  [
    "directory cycle",
    (b: Buffer) => {
      both32(
        b,
        20 * SECTOR + 68 + record("SYSTEM.CNF;1", 22, 1).length + 2,
        20,
      );
    },
    /cycle/,
  ],
  [
    "inconsistent self directory",
    (b: Buffer) => {
      both32(b, 20 * SECTOR + 10, 100);
    },
    /self\/parent/,
  ],
  [
    "multi-extent file",
    (b: Buffer) => {
      b[20 * SECTOR + 68 + 25] = 0x80;
    },
    /multi-extent/,
  ],
  [
    "unsafe member name",
    (b: Buffer) => {
      b[20 * SECTOR + 68 + 33] = 47;
    },
    /Unsafe/,
  ],
  [
    "missing descriptor terminator",
    (b: Buffer) => {
      b[17 * SECTOR] = 2;
    },
    /descriptor sequence/,
  ],
] as const) {
  test(`malformed ISO rejects ${name}`, async (t) => {
    const data = fixture();
    mutate(data);
    const { source } = await setup(t, data);
    await assert.rejects(Iso9660Image.open(source), expected);
  });
}

for (const malformed of ["out-of-source", "endian-mismatch"]) {
  test(`unavailable ${malformed} regular file does not prevent valid boot extraction`, async (t) => {
    const data = fixture();
    if (malformed === "out-of-source")
      both32(data, 20 * SECTOR + 68 + 2, 100000);
    else data[20 * SECTOR + 68 + 6] = 1;
    const { source, workspace } = await setup(t, data);
    const inspected = await runWithWorkspaceRoot(workspace, () =>
      inspectDiscImageTool.handler({ path: source, search: "SLUS" }),
    );
    assert(inspected.ok);
    const output = JSON.parse(inspected.output);
    assert.equal(output.inventory_complete, false);
    assert.equal(output.issue_count, 1);
    assert.equal(output.issues[0].path, "/SYSTEM.CNF");
    assert.equal(output.issues[0].available, false);
    assert.equal(output.entries[0].path, "/SLUS_123.45");
    const valid = await runWithWorkspaceRoot(workspace, () =>
      extractDiscFileTool.handler({
        path: source,
        member_path: "/SLUS_123.45",
        destination: "boot.elf",
      }),
    );
    assert(valid.ok);
    assert.equal(JSON.parse(valid.output).observations.machine, 8);
    const invalid = await runWithWorkspaceRoot(workspace, () =>
      extractDiscFileTool.handler({
        path: source,
        member_path: "/SYSTEM.CNF",
        destination: "invalid.bin",
      }),
    );
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.match(invalid.error, /unavailable/);
    await assert.rejects(stat(path.join(workspace, "invalid.bin")), {
      code: "ENOENT",
    });
  });
}
