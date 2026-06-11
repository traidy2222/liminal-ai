import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scopesForXeroMode,
  xeroBundleMissingPhase3Scopes,
  xeroBundleMissingRequiredScopes,
  xeroBundleMissingScopes,
  xeroRequiredScopesForCall,
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
    assert.ok(scopes.includes("accounting.journals.read"));
    assert.ok(scopes.includes("files"));
    assert.ok(scopes.includes("projects.read"));
    assert.ok(scopes.includes("payroll.employees"));
    assert.ok(scopes.includes("accounting.budgets.read"));
    assert.ok(scopes.includes("accounting.classicexpenses.read"));
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

  it("xeroRequiredScopesForCall maps API bases and paths", () => {
    assert.deepEqual(
      xeroRequiredScopesForCall({
        apiBase: "https://api.xero.com/files.xro/1.0",
        path: "/Files",
      }),
      ["files.read"]
    );
    assert.deepEqual(
      xeroRequiredScopesForCall({
        apiBase: "https://api.xero.com/api.xro/2.0",
        path: "/Budgets",
      }),
      ["accounting.budgets.read"]
    );
    assert.deepEqual(
      xeroBundleMissingRequiredScopes(["accounting.budgets.read"], ["accounting.budgets.read"]),
      []
    );
  });

  it("xeroBundleMissingPhase3Scopes detects missing journals/files/projects/payroll", () => {
    const missing = xeroBundleMissingPhase3Scopes([
      "accounting.journals.read",
      "files.read",
    ]);
    assert.ok(missing.includes("projects.read"));
    assert.ok(missing.includes("payroll.employees.read"));
    assert.ok(!missing.includes("accounting.journals.read"));
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
