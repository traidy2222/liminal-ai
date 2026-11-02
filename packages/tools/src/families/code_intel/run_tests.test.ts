import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runTestsTool } from "./run_tests.js";
test("required test script cannot silently pass when absent, and real failing/passing tests return actual outcomes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-required-test-"));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "test-fixture", version: "1.0.0", scripts: {} }),
    );
    const absent = await runTestsTool.handler({ cwd: root });
    assert.equal(absent.ok, false);
    if (!absent.ok) assert.match(absent.error, /missing/);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "test-fixture",
        version: "1.0.0",
        scripts: { test: "node --test check.test.cjs" },
      }),
    );
    await writeFile(
      path.join(root, "check.test.cjs"),
      "require('node:test')('regression',()=>require('node:assert/strict').equal(2+3,6));",
    );
    const failed = await runTestsTool.handler({ cwd: root });
    assert.equal(failed.ok, false, JSON.stringify(failed));
    await writeFile(
      path.join(root, "check.test.cjs"),
      "require('node:test')('regression',()=>require('node:assert/strict').equal(2+3,5));",
    );
    const pass = await runTestsTool.handler({ cwd: root });
    assert.equal(pass.ok, true);
    if (pass.ok) assert.match(pass.output, /# pass 1/);
    const invalid = await runTestsTool.handler({
      cwd: root,
      script: "test & echo injected",
    });
    assert.equal(invalid.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
