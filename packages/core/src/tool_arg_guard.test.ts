import test from "node:test";
import assert from "node:assert/strict";
import { guardToolArgs } from "./tool_arg_guard.js";

test("guard blocks rm -rf / in run_shell", () => {
  assert.equal(
    guardToolArgs("run_shell", { command: "rm -rf /" }) !== null,
    true
  );
});

test("guard allows benign echo", () => {
  assert.equal(guardToolArgs("run_shell", { command: "echo hello" }), null);
});

test("guard blocks loopback web_fetch", () => {
  assert.match(guardToolArgs("web_fetch", { url: "http://127.0.0.1:8080/" }) ?? "", /loopback/);
});

test("guard allows https example.com", () => {
  assert.equal(guardToolArgs("web_fetch", { url: "https://example.com/" }), null);
});

test("execute_code allows valid python snippet", () => {
  assert.equal(
    guardToolArgs("execute_code", {
      language: "python",
      code: "print(2 + 2)",
      timeout_ms: 5_000,
      cwd: ".",
    }),
    null
  );
});

test("execute_code blocks dangerous process escape pattern", () => {
  assert.match(
    guardToolArgs("execute_code", {
      language: "javascript",
      code: "require('child_process').exec('whoami')",
    }) ?? "",
    /dangerous/i
  );
});

test("execute_code blocks invalid timeout and cwd escape", () => {
  assert.match(
    guardToolArgs("execute_code", {
      language: "python",
      code: "print('x')",
      timeout_ms: 999_999,
      cwd: "../..",
    }) ?? "",
    /timeout_ms/i
  );
  assert.match(
    guardToolArgs("execute_code", {
      language: "python",
      code: "print('x')",
      timeout_ms: 20_000,
      cwd: "../..",
    }) ?? "",
    /workspace-relative/i
  );
});
