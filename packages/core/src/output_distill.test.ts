import test from "node:test";
import assert from "node:assert/strict";
import { readArtifactText } from "./output_distill.js";

test("readArtifactText returns helpful error when artifact file is missing", async () => {
  const r = await readArtifactText("deadbeef");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /Artifact not found/i);
  assert.match(r.error, /AGENT_DISTILL|AGENT_TOOL_BODY_ELIDE/i);
});
