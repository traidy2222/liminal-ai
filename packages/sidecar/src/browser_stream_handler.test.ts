import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBrowserStreamServer, tryHandleBrowserStreamUpgrade } from "./browser_stream_handler.js";
import type { IncomingMessage } from "node:http";
import { Socket } from "node:net";

describe("tryHandleBrowserStreamUpgrade", () => {
  it("ignores unrelated paths", () => {
    const wss = createBrowserStreamServer();
    const socket = new Socket();
    let destroyed = false;
    socket.destroy = () => {
      destroyed = true;
      return socket;
    };
    const req = { url: "/other" } as IncomingMessage;
    const handled = tryHandleBrowserStreamUpgrade(
      req,
      socket,
      Buffer.alloc(0),
      { token: "t" },
      wss
    );
    assert.equal(handled, false);
    assert.equal(destroyed, false);
  });
});
