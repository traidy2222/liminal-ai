import test from "node:test";
import assert from "node:assert/strict";
import {
  scrubMessagesSpecialTokens,
  stripProviderSpecialTokens,
} from "./provider_token_scrub.js";

test("stripProviderSpecialTokens removes chat control tokens", () => {
  assert.equal(
    stripProviderSpecialTokens("hello <|endoftext|> world"),
    "hello  world"
  );
  assert.equal(stripProviderSpecialTokens("ok"), "ok");
});

test("scrubMessagesSpecialTokens cleans assistant strings", () => {
  const imEnd = "<|" + "im_end" + "|>";
  const out = scrubMessagesSpecialTokens([
    { role: "assistant", content: "done $imEnd" },
    { role: "user", content: "hi" },
  ]);
  assert.equal(out[0]?.content, "done ");
  assert.equal(out[1]?.content, "hi");
});
