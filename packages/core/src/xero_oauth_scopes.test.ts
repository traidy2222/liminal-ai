import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scopesForXeroMode,
  xeroBundleMissingCoreScopes,
  xeroBundleMissingPhase3Scopes,
  xeroBundleMissingRequiredScopes,
  xeroBundleMissingScopes,
  xeroRequiredScopesForCall,
} from "./xero_oauth_scopes.js";

describe("xero_oauth_scopes", () => {
  it("read_write legacy default uses broad scopes (pre-2026-03-02 apps)", () => {
    const scopes = scopesForXeroMode("read_write");
    assert.ok(scopes.includes("offline_access"));
    assert.ok(scopes.includes("accounting.transactions"));
    assert.ok(scopes.includes("accounting.transactions.read"));
    assert.ok(scopes.includes("accounting.reports.read"));
    assert.ok(scopes.includes("accounting.budgets"));
    assert.ok(!scopes.includes("accounting.invoices.read"));
    assert.ok(!scopes.includes("accounting.classicexpenses"));
    assert.ok(!scopes.includes("files.read"));
  });

  it("granular style uses split scopes for new Xero apps", () => {
    const scopes = scopesForXeroMode("read_write", { style: "granular" });
    assert.ok(scopes.includes("accounting.invoices.read"));
    assert.ok(scopes.includes("accounting.invoices"));
    assert.ok(!scopes.includes("accounting.transactions.read"));
  });

  it("extended adds phase 3 scopes", () => {
    const scopes = scopesForXeroMode("read_write", { extended: true });
    assert.ok(scopes.includes("files.read"));
    assert.ok(scopes.includes("projects.read"));
    assert.ok(scopes.includes("payroll.employees.read"));
    assert.ok(scopes.includes("accounting.journals.read"));
  });

  it("read_only legacy omits write scopes", () => {
    const scopes = scopesForXeroMode("read_only");
    assert.ok(scopes.includes("accounting.transactions.read"));
    assert.ok(!scopes.includes("accounting.transactions"));
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
      ["accounting.budgets"]
    );
    assert.deepEqual(
      xeroBundleMissingRequiredScopes(["accounting.budgets"], ["accounting.budgets"]),
      []
    );
  });

  it("xeroBundleMissingPhase3Scopes detects missing journals/files/projects/payroll", () => {
    const missing = xeroBundleMissingPhase3Scopes(["accounting.journals.read", "files.read"]);
    assert.ok(missing.includes("projects.read"));
    assert.ok(missing.includes("payroll.employees.read"));
    assert.ok(!missing.includes("accounting.journals.read"));
  });

  it("legacy token satisfies granular core scope checks", () => {
    const token = [
      "accounting.transactions",
      "accounting.transactions.read",
      "accounting.reports.read",
      "accounting.contacts",
      "accounting.contacts.read",
      "accounting.settings",
      "accounting.settings.read",
      "accounting.attachments",
      "accounting.attachments.read",
      "accounting.budgets",
    ];
    assert.equal(xeroBundleMissingCoreScopes(token).length, 0);
    assert.ok(xeroBundleMissingPhase3Scopes(token).length > 0);
    assert.ok(xeroBundleMissingScopes(token).length > 0);
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
    assert.ok(!missing.includes("accounting.manualjournals.read"));
  });
});
