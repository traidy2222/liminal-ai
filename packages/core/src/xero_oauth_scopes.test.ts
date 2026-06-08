import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scopesForXeroMode } from "./xero_oauth_scopes.js";

describe("xero_oauth_scopes", () => {
  it("read_write includes granular write scopes and offline_access", () => {
    const scopes = scopesForXeroMode("read_write");
    assert.ok(scopes.includes("offline_access"));
    assert.ok(scopes.includes("accounting.invoices"));
    assert.ok(scopes.includes("accounting.contacts"));
    assert.ok(!scopes.includes("accounting.invoices.read"));
    assert.ok(!scopes.includes("accounting.transactions"));
  });

  it("read_only uses granular read scopes only", () => {
    const scopes = scopesForXeroMode("read_only");
    assert.ok(scopes.includes("accounting.invoices.read"));
    assert.ok(!scopes.includes("accounting.invoices"));
    assert.ok(!scopes.includes("accounting.transactions.read"));
  });
});
