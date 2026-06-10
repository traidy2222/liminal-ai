import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMINAL_EXIT_MARKER, wrapOneshotCommand, wrapBackgroundCommand } from "./terminal_shell_runtime.js";

test("wrapOneshotCommand includes exit marker", () => {
  const cmd = wrapOneshotCommand("echo hi");
  assert.ok(cmd.includes(LIMINAL_EXIT_MARKER));
  assert.ok(cmd.includes("echo hi"));
});

test("wrapOneshotCommand with cwd", () => {
  const cmd = wrapOneshotCommand("npm test", "/tmp/proj");
  assert.ok(cmd.includes("npm test"));
  if (process.platform === "win32") {
    assert.ok(cmd.includes("Set-Location"));
  } else {
    assert.ok(cmd.includes("cd "));
  }
});

test("wrapBackgroundCommand does not include exit marker", () => {
  const cmd = wrapBackgroundCommand("npm run dev");
  assert.ok(!cmd.includes(LIMINAL_EXIT_MARKER));
  assert.ok(cmd.includes("npm run dev"));
});
