import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatIdentityRecallBlock, IDENTITY_MEMORY_KEYS } from "./user_identity_memory.js";

describe("user_identity_memory", () => {
  it("formatIdentityRecallBlock lists keys", () => {
    const block = formatIdentityRecallBlock([
      { key: "user:name", value: "Alex" },
      { key: "pref:call_name", value: "Al" },
    ]);
    assert.match(block, /user:name/);
    assert.match(block, /Alex/);
  });

  it("IDENTITY_MEMORY_KEYS includes user:name", () => {
    assert.ok(IDENTITY_MEMORY_KEYS.includes("user:name"));
  });
});
