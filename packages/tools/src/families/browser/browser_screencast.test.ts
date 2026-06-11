import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseBrowserStreamInput } from "./browser_screencast.js";

describe("parseBrowserStreamInput", () => {
  it("parses click", () => {
    assert.deepEqual(parseBrowserStreamInput({ type: "click", x: 10, y: 20 }), {
      type: "click",
      x: 10,
      y: 20,
      button: "left",
    });
  });

  it("parses wheel", () => {
    assert.deepEqual(
      parseBrowserStreamInput({ type: "wheel", x: 1, y: 2, deltaY: -120 }),
      { type: "wheel", x: 1, y: 2, deltaX: 0, deltaY: -120 }
    );
  });

  it("rejects invalid payloads", () => {
    assert.equal(parseBrowserStreamInput(null), null);
    assert.equal(parseBrowserStreamInput({ type: "click", x: "bad", y: 1 }), null);
  });
});
