import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capShellToolOutput,
  cleanShellOutputForTool,
  isNoisyShellOutputLine,
} from "./shell_tool_output.js";

test("isNoisyShellOutputLine detects PATH dumps", () => {
  const pathLine =
    "C:\\Windows;C:\\Program Files\\Foo;C:\\Program Files\\Bar;C:\\Program Files\\Baz;" +
    "C:\\Program Files\\Qux;C:\\Program Files\\Quux;C:\\Users\\x\\AppData";
  assert.equal(isNoisyShellOutputLine(pathLine), true);
  assert.equal(isNoisyShellOutputLine("hello"), false);
});

test("cleanShellOutputForTool omits noisy lines and PS banner", () => {
  const raw = [
    "Windows PowerShell",
    "Copyright (C) Microsoft",
    "SHELL_TEST_OK",
    "C:\\Windows;C:\\Program Files\\Foo;C:\\Program Files\\Bar;C:\\Program Files\\Baz;" +
      "C:\\Program Files\\Qux;C:\\Program Files\\Quux;C:\\Users\\x\\AppData",
  ].join("\n");
  const out = cleanShellOutputForTool(raw);
  assert.ok(out.includes("SHELL_TEST_OK"));
  assert.ok(!out.includes("Program Files\\Quux"));
  assert.ok(out.includes("omitted"));
});

test("capShellToolOutput truncates very long bodies", () => {
  const body = "x".repeat(20_000);
  const out = capShellToolOutput(body);
  assert.ok(out.length < 20_000);
  assert.ok(out.includes("Terminal panel"));
});
