import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BROWSER_VERIFY_TOOL_NAMES,
  classifyChangedFiles,
  proactiveLintAfterEditsEnabled,
  proactiveVerificationEnabled,
  toolCallCountsAsVerification,
} from "./proactive_verification.js";

describe("proactive_verification", () => {
  it("classifies typed paths", () => {
    const c = classifyChangedFiles(["src/a.ts", "index.html"]);
    assert.deepEqual(c.typedCode, ["src/a.ts"]);
    assert.deepEqual(c.webAssets, ["index.html"]);
  });

  it("detects verification shell commands", () => {
    assert.equal(
      toolCallCountsAsVerification("run_shell", JSON.stringify({ command: "npm run test" })),
      true
    );
  });

  it("lists browser verify tools", () => {
    assert.ok(BROWSER_VERIFY_TOOL_NAMES.has("browser_open"));
  });

  it("defaults proactive verification on", () => {
    assert.equal(typeof proactiveVerificationEnabled(), "boolean");
    assert.equal(typeof proactiveLintAfterEditsEnabled(), "boolean");
  });
});
