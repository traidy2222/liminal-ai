import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scopesForXeroMode,
  xeroBundleMissingScopes,
} from "./xero_oauth_scopes.js";

describe("xero_oauth_scopes", () => {
  it("read_write includes read + write granular scopes and offline_access", () => {
    const scopes = scopesForXeroMode("read_write");
    assert.ok(scopes.includes("offline_access"));
    assert.ok(scopes.includes("accounting.invoices"));
    assert.ok(scopes.includes("accounting.invoices.read"));
    assert.ok(scopes.includes("accounting.payments"));
    assert.ok(scopes.includes("accounting.payments.read"));
    assert.ok(scopes.includes("accounting.banktransactions.read"));
    assert.ok(scopes.includes("accounting.reports.profitandloss.read"));
    assert.ok(!scopes.includes("accounting.transactions"));
  });

  it("read_only uses granular read scopes only", () => {
    const scopes = scopesForXeroMode("read_only");
    assert.ok(scopes.includes("accounting.invoices.read"));
    assert.ok(scopes.includes("accounting.payments.read"));
    assert.ok(!scopes.includes("accounting.invoices"));
    assert.ok(!scopes.includes("accounting.transactions.read"));
  });

  it("xeroBundleMissingScopes detects legacy narrow grants", () => {
    const missing = xeroBundleMissingScopes([
      "accounting.invoices",
      "accounting.contacts",
      "accounting.settings",
      "accounting.invoices.read",
      "accounting.contacts.read",
      "accounting.settings.read",
    ]);
    assert.ok(missing.includes("accounting.payments.read"));
    assert.ok(missing.includes("accounting.reports.profitandloss.read"));
  });

  it("xeroBundleMissingScopes treats legacy monolithic scopes as sufficient", () => {
    const missing = xeroBundleMissingScopes([
      "openid",
      "accounting.transactions",
      "accounting.transactions.read",
      "accounting.contacts",
      "accounting.contacts.read",
      "accounting.settings",
      "accounting.settings.read",
      "accounting.reports.read",
    ]);
    assert.ok(!missing.includes("accounting.payments.read"));
    assert.ok(!missing.includes("accounting.reports.profitandloss.read"));
    assert.ok(missing.includes("accounting.manualjournals.read"));
  });
});
