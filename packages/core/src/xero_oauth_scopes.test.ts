import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  probeXeroAuthorizeScopes,
  scopesForXeroMode,
  xeroBundleMissingCoreScopes,
  xeroBundleMissingFullScopes,
  xeroBundleMissingPhase3Scopes,
  xeroBundleMissingRequiredScopes,
  xeroBundleMissingScopes,
  xeroRequiredScopesForCall,
} from "./xero_oauth_scopes.js";

describe("xero_oauth_scopes", () => {
  it("granular default connect tier uses minimal scopes for post-2026-03-02 apps", () => {
    const scopes = scopesForXeroMode("read_write");
    assert.ok(scopes.includes("offline_access"));
    assert.ok(scopes.includes("accounting.invoices.read"));
    assert.ok(scopes.includes("accounting.invoices"));
    assert.ok(!scopes.includes("accounting.transactions"));
    assert.ok(!scopes.includes("accounting.reports.profitandloss.read"));
    assert.ok(!scopes.includes("accounting.budgets"));
    assert.ok(!scopes.includes("accounting.budgets.read"));
    assert.ok(!scopes.includes("accounting.banktransactions"));
    assert.ok(!scopes.includes("files.read"));
  });

  it("legacy style uses broad scopes for pre-2026-03-02 apps", () => {
    const scopes = scopesForXeroMode("read_write", { style: "legacy" });
    assert.ok(scopes.includes("accounting.transactions"));
    assert.ok(scopes.includes("accounting.transactions.read"));
    assert.ok(scopes.includes("accounting.reports.read"));
    assert.ok(!scopes.includes("accounting.invoices.read"));
    assert.ok(!scopes.includes("accounting.classicexpenses"));
  });

  it("full tier adds reports and budgets.read but not accounting.budgets write", () => {
    const scopes = scopesForXeroMode("read_write", { tier: "full" });
    assert.ok(scopes.includes("accounting.reports.profitandloss.read"));
    assert.ok(scopes.includes("accounting.budgets.read"));
    assert.ok(scopes.includes("accounting.banktransactions"));
    assert.ok(!scopes.includes("accounting.budgets"));
  });

  it("extended adds phase 3 scopes without journals by default", () => {
    const scopes = scopesForXeroMode("read_write", { extended: true });
    assert.ok(scopes.includes("files.read"));
    assert.ok(scopes.includes("projects.read"));
    assert.ok(scopes.includes("payroll.employees.read"));
    assert.ok(!scopes.includes("accounting.journals.read"));
  });

  it("journals opt-in", () => {
    const scopes = scopesForXeroMode("read_write", { journals: true });
    assert.ok(scopes.includes("accounting.journals.read"));
  });

  it("connect token has no missing core scopes", () => {
    const connect = scopesForXeroMode("read_write");
    const missing = xeroBundleMissingCoreScopes(connect);
    assert.equal(missing.length, 0);
  });

  it("connect token may have missing full-tier scopes", () => {
    const connect = scopesForXeroMode("read_write");
    const missingFull = xeroBundleMissingFullScopes(connect);
    assert.ok(missingFull.includes("accounting.reports.profitandloss.read"));
    assert.ok(missingFull.includes("accounting.budgets.read"));
  });

  it("read_only legacy omits write scopes", () => {
    const scopes = scopesForXeroMode("read_only", { style: "legacy" });
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
        method: "POST",
      }),
      ["accounting.budgets.read"]
    );
    assert.deepEqual(
      xeroBundleMissingRequiredScopes(["accounting.budgets.read"], ["accounting.budgets.read"]),
      []
    );
  });

  it("xeroBundleMissingPhase3Scopes detects missing files/projects/payroll", () => {
    const missing = xeroBundleMissingPhase3Scopes(["files.read"]);
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

const probeClientId = process.env.XERO_OAUTH_CLIENT_ID?.trim();
const probeRedirect = process.env.XERO_OAUTH_PROBE_REDIRECT_URI?.trim();

describe("xero_oauth_scopes live probe", { skip: !probeClientId || !probeRedirect }, () => {
  it("connect and full tiers are accepted by Xero authorize", async () => {
    const connect = await probeXeroAuthorizeScopes({
      clientId: probeClientId!,
      redirectUri: probeRedirect!,
      scopes: scopesForXeroMode("read_write"),
    });
    assert.equal(connect.ok, true, `connect rejected: ${connect.location}`);

    const full = await probeXeroAuthorizeScopes({
      clientId: probeClientId!,
      redirectUri: probeRedirect!,
      scopes: scopesForXeroMode("read_write", { tier: "full" }),
    });
    assert.equal(full.ok, true, `full rejected: ${full.location}`);

    const bad = await probeXeroAuthorizeScopes({
      clientId: probeClientId!,
      redirectUri: probeRedirect!,
      scopes: [...scopesForXeroMode("read_write", { tier: "full" }), "accounting.budgets"],
    });
    assert.equal(bad.ok, false, "accounting.budgets write should be rejected on new apps");
  });
});
