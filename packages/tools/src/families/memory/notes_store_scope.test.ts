import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { defaultScopeForKey } from "./notes_store.js";

describe("federation: defaultScopeForKey", () => {
  it("auto-globals identity-shaped keys regardless of workspace", () => {
    assert.equal(defaultScopeForKey("user:name", true), "global");
    assert.equal(defaultScopeForKey("user:name", false), "global");
    assert.equal(defaultScopeForKey("identity:role", true), "global");
    assert.equal(defaultScopeForKey("pref:editor", false), "global");
  });

  it("defaults non-identity keys to workspace when a fingerprint resolves", () => {
    assert.equal(defaultScopeForKey("fact:auth", true), "workspace");
    assert.equal(defaultScopeForKey("recipe:deploy", true), "workspace");
    assert.equal(defaultScopeForKey("trajectory:abc123", true), "workspace");
  });

  it("falls back to global when no fingerprint resolves", () => {
    assert.equal(defaultScopeForKey("fact:auth", false), "global");
    assert.equal(defaultScopeForKey("anything", false), "global");
  });

  it("untyped keys use the same default path as typed", () => {
    assert.equal(defaultScopeForKey("ad_hoc_note", true), "workspace");
    assert.equal(defaultScopeForKey("ad_hoc_note", false), "global");
  });
});
