import test from "node:test";
import assert from "node:assert/strict";
import { resolveShellRuntime, shellProtocolGuidance } from "./platform_context.js";

test("resolveShellRuntime returns executable and args", () => {
  const runtime = resolveShellRuntime();
  assert.ok(runtime.executable.length > 0);
  assert.ok(Array.isArray(runtime.args));
  assert.ok(runtime.displayName.length > 0);
});

test("shellProtocolGuidance includes runtime heading", () => {
  const block = shellProtocolGuidance();
  assert.ok(block.includes("## Shell runtime"));
  assert.ok(block.includes("Detected shell:"));
});

