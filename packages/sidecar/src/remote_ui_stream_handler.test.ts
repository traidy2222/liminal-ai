import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRemoteUiInput } from "./remote_ui_stream_handler.js";

describe("parseRemoteUiInput", () => {
  it("parses click", () => {
    assert.deepEqual(parseRemoteUiInput({ type: "click", x: 10, y: 20 }), {
      type: "click",
      x: 10,
      y: 20,
      button: "left",
    });
  });

  it("parses wheel", () => {
    assert.deepEqual(parseRemoteUiInput({ type: "wheel", x: 1, y: 2, deltaY: -3 }), {
      type: "wheel",
      x: 1,
      y: 2,
      deltaX: 0,
      deltaY: -3,
    });
  });
});
