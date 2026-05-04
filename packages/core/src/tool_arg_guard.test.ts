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
