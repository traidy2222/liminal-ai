import test from "node:test";
import assert from "node:assert/strict";
import {
  createContentStreamParseState,
  getDecodedContentFromRaw,
  ingestToolArgJsonDelta,
} from "./tool_arg_content_stream.js";

test("ingestToolArgJsonDelta decodes path and content incrementally", () => {
  const state = createContentStreamParseState();
  ingestToolArgJsonDelta(state, '{"path":"foo.ts","content":"line1\\n');
  const second = ingestToolArgJsonDelta(state, 'line2"}');
  assert.equal(state.path, "foo.ts");
  assert.equal(getDecodedContentFromRaw(state), "line1\nline2");
  assert.ok(second.newContent.length > 0);
});
