import assert from "node:assert/strict";
import test from "node:test";
import {
  formatWikilink,
  predictedRelLinkPath,
  wikilinkLookupKey,
} from "./vault_wikilink.js";

test("formatWikilink uses alias when label slug differs from path basename", () => {
  assert.equal(
    formatWikilink("Entities/iran", "Islamic Republic of Iran"),
    "[[Entities/iran|Islamic Republic of Iran]]"
  );
});

test("formatWikilink omits alias when label matches slug", () => {
  assert.equal(formatWikilink("Entities/iran", "iran"), "[[Entities/iran]]");
});

test("predictedRelLinkPath uses type folder + slug under agent prefix", () => {
  const path = predictedRelLinkPath("entity", "OpenAI");
  assert.ok(path.endsWith("Entities/openai"));
  assert.ok(path.includes("/"));
});

test("wikilinkLookupKey uses basename", () => {
  assert.equal(wikilinkLookupKey("AI/Entities/iran"), "iran");
});
