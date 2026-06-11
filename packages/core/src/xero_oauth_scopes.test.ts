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
  it("read_write includes core granular scopes and offline_access", () => {
    const scopes = scopesForXeroMode("read_write");
    assert.ok(scopes.includes("offline_access"));
    assert.ok(scopes.includes("accounting.invoices"));
    assert.ok(scopes.includes("accounting.invoices.read"));
    assert.ok(scopes.includes("accounting.budgets"));
    assert.ok(!scopes.includes("accounting.budgets.read"));
    assert.ok(!scopes.includes("accounting.classicexpenses"));
    assert.ok(!scopes.includes("files.read"));
    assert.ok(!scopes.includes("accounting.transactions"));
  });

  it("extended adds phase 3 scopes", () => {
    const scopes = scopesForXeroMode("read_write", { extended: true });
    assert.ok(scopes.includes("files.read"));
    assert.ok(scopes.includes("projects.read"));
    assert.ok(scopes.includes("payroll.employees.read"));
    assert.ok(scopes.includes("accounting.journals.read"));
  });

  it("read_only uses granular read scopes only", () => {
    const scopes = scopesForXeroMode("read_only");
    assert.ok(scopes.includes("accounting.invoices.read"));
    assert.ok(!scopes.includes("accounting.invoices"));
    assert.ok(!scopes.includes("accounting.transactions.read"));
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

  it("xeroBundleMissingCoreScopes ignores extended scopes", () => {
    const token = [
      "accounting.invoices",
      "accounting.invoices.read",
      "accounting.contacts",
      "accounting.contacts.read",
      "accounting.settings",
      "accounting.settings.read",
      "accounting.payments",
      "accounting.payments.read",
      "accounting.banktransactions",
      "accounting.banktransactions.read",
      "accounting.manualjournals",
      "accounting.manualjournals.read",
      "accounting.attachments",
      "accounting.attachments.read",
      "accounting.reports.aged.read",
      "accounting.reports.balancesheet.read",
      "accounting.reports.banksummary.read",
      "accounting.reports.executivesummary.read",
      "accounting.reports.profitandloss.read",
      "accounting.reports.trialbalance.read",
      "accounting.reports.taxreports.read",
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
    assert.ok(missing.includes("accounting.manualjournals.read"));
  });
});
