import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearHandshake,
  handshakePath,
  liminalHome,
  mintToken,
  writeHandshake,
} from "./handshake.js";

test("mintToken returns a 64-char hex string and is unique", () => {
  const a = mintToken();
  const b = mintToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("LIMINAL_HOME overrides the handshake directory", () => {
  const prev = process.env["LIMINAL_HOME"];
  process.env["LIMINAL_HOME"] = "C:/tmp/liminal-test-home";
  try {
    assert.equal(liminalHome(), "C:/tmp/liminal-test-home");
    assert.equal(handshakePath(), join("C:/tmp/liminal-test-home", "sidecar.json"));
  } finally {
    if (prev === undefined) delete process.env["LIMINAL_HOME"];
    else process.env["LIMINAL_HOME"] = prev;
  }
});

test("writeHandshake persists a versioned record and clearHandshake removes it", async () => {
  const prev = process.env["LIMINAL_HOME"];
  const dir = await mkdtemp(join(tmpdir(), "liminal-hs-"));
  process.env["LIMINAL_HOME"] = dir;
  try {
    const rec = await writeHandshake({ port: 54321, token: "abc", pid: 999 });
    assert.equal(rec.port, 54321);
    assert.equal(rec.protocolVersion, 1);
    assert.ok(rec.startedAt > 0);

    const onDisk = JSON.parse(await readFile(handshakePath(), "utf8"));
    assert.equal(onDisk.port, 54321);
    assert.equal(onDisk.token, "abc");

    await clearHandshake();
    await assert.rejects(() => readFile(handshakePath(), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env["LIMINAL_HOME"];
    else process.env["LIMINAL_HOME"] = prev;
  }
});
