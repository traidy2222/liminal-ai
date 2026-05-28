import test from "node:test";
import assert from "node:assert/strict";
import {
  batchHasUndispatchableFileWrites,
  canEagerDispatchTool,
  fileWriteSafeToDispatch,
  isLikelyTruncatedFileContent,
  shouldDispatchToolBatch,
  shouldEagerDispatchWhenArgsComplete,
  tryParseToolArgs,
} from "./file_write_resume.js";

test("tryParseToolArgs rejects invalid JSON", () => {
  assert.equal(tryParseToolArgs('{"path":"a.ts","content":"hi').ok, false);
});

test("isLikelyTruncatedFileContent detects unclosed string", () => {
  assert.equal(isLikelyTruncatedFileContent('const x = "hello'), true);
  assert.equal(isLikelyTruncatedFileContent("const x = 1;\n"), false);
});

test("isLikelyTruncatedFileContent ignores apostrophes in comments", () => {
  const debounceWithJsDoc = `/**
 * debounced function's return value
 */
export function debounce<T>(fn: () => T): () => T | undefined {
  return () => undefined;
}`;
  assert.equal(isLikelyTruncatedFileContent(debounceWithJsDoc), false);
});

test("batchHasUndispatchableFileWrites on truncated write_file args", () => {
  const calls = [
    {
      id: "1",
      name: "write_file",
      argsJson: JSON.stringify({ path: "big.ts", content: 'export const x = "' }),
    },
  ];
  assert.equal(batchHasUndispatchableFileWrites(calls, "length"), true);
});

test("batchHasUndispatchableFileWrites passes complete write_file args", () => {
  const calls = [
    {
      id: "1",
      name: "write_file",
      argsJson: JSON.stringify({ path: "ok.ts", content: "export const x = 1;\n" }),
    },
  ];
  assert.equal(batchHasUndispatchableFileWrites(calls, "tool_calls"), false);
});

test("shouldDispatchToolBatch with finish_reason stop and complete write_file", () => {
  const calls = [
    {
      id: "1",
      name: "write_file",
      argsJson: JSON.stringify({ path: "ok.ts", content: "hello\n" }),
    },
  ];
  assert.equal(shouldDispatchToolBatch(calls, "stop"), true);
  assert.equal(shouldDispatchToolBatch(calls, null), true);
  assert.equal(shouldDispatchToolBatch(calls, "tool_calls"), true);
});

test("shouldDispatchToolBatch rejects truncated write_file on length", () => {
  const calls = [
    {
      id: "1",
      name: "write_file",
      argsJson: JSON.stringify({ path: "big.ts", content: 'export const x = "' }),
    },
  ];
  assert.equal(shouldDispatchToolBatch(calls, "length"), false);
});

test("shouldDispatchToolBatch rejects incomplete JSON", () => {
  const calls = [{ id: "1", name: "read_file", argsJson: '{"path":"a.ts"' }];
  assert.equal(shouldDispatchToolBatch(calls, "stop"), false);
});

test("canEagerDispatchTool allows cautious write_file, blocks destructive approval", () => {
  assert.equal(
    canEagerDispatchTool({ requiresApproval: true, dangerLevel: "cautious" }),
    true
  );
  assert.equal(
    canEagerDispatchTool({ requiresApproval: true, dangerLevel: "destructive" }),
    false
  );
});

test("shouldEagerDispatchWhenArgsComplete does not eager-dispatch write_file", () => {
  const cautious = { requiresApproval: true, dangerLevel: "cautious" as const };
  assert.equal(shouldEagerDispatchWhenArgsComplete("write_file", cautious, false), false);
  assert.equal(shouldEagerDispatchWhenArgsComplete("read_file", cautious, false), false);
  assert.equal(shouldEagerDispatchWhenArgsComplete("read_file", { dangerLevel: "safe" }, true), true);
});

test("fileWriteSafeToDispatch allows length finish when JSON and content are complete", () => {
  const tc = {
    id: "1",
    name: "write_file",
    argsJson: JSON.stringify({ path: "ok.ts", content: "export const x = 1;\n" }),
  };
  assert.equal(fileWriteSafeToDispatch(tc, "length"), true);
  assert.equal(fileWriteSafeToDispatch(tc, "tool_calls"), true);
});

test("batchHasUndispatchableFileWrites passes complete write_file on length finish", () => {
  const calls = [
    {
      id: "1",
      name: "write_file",
      argsJson: JSON.stringify({ path: "ok.ts", content: "export const x = 1;\n" }),
    },
  ];
  assert.equal(batchHasUndispatchableFileWrites(calls, "length"), false);
  assert.equal(shouldDispatchToolBatch(calls, "length"), true);
});
