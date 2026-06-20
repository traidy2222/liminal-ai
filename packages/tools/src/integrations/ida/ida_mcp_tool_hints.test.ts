import test from "node:test";
import assert from "node:assert/strict";
import { enrichIdaMcpToolDescription } from "./ida_mcp_tool_hints.js";

test("enrichIdaMcpToolDescription adds patch export hint for apply_patches_to_input", () => {
  const out = enrichIdaMcpToolDescription("ida", "apply_patches_to_input", "Export patched file.");
  assert.match(out, /apply_patches_to_input/);
  assert.match(out, /patched PE\/DLL/i);
});

test("enrichIdaMcpToolDescription adds int_convert rule", () => {
  const out = enrichIdaMcpToolDescription("ida", "int_convert", "Convert numbers.");
  assert.match(out, /NEVER convert/i);
});

test("enrichIdaMcpToolDescription ignores non-ida connections", () => {
  const base = "List repos.";
  assert.equal(enrichIdaMcpToolDescription("github", "list_repos", base), base);
});
