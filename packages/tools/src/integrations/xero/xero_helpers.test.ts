import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterBankAccounts,
  lineItemsFromEntity,
  pickDefaultSalesLineDefaults,
  xeroEntityArray,
} from "./xero_helpers.js";

describe("xero_helpers", () => {
  it("xeroEntityArray extracts keyed arrays", () => {
    const rows = xeroEntityArray({ Contacts: [{ Name: "A" }] }, "Contacts");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.["Name"], "A");
  });

  it("filterBankAccounts keeps BANK type", () => {
    const banks = filterBankAccounts([
      { Type: "BANK", Code: "090" },
      { Type: "REVENUE", Code: "200" },
    ]);
    assert.equal(banks.length, 1);
    assert.equal(banks[0]?.["Code"], "090");
  });

  it("pickDefaultSalesLineDefaults picks revenue account", () => {
    const d = pickDefaultSalesLineDefaults(
      [{ Type: "REVENUE", Code: "200" }],
      [{ TaxType: "OUTPUT", ReportTaxType: "OUTPUT" }]
    );
    assert.equal(d.accountCode, "200");
    assert.equal(d.taxType, "OUTPUT");
  });

  it("lineItemsFromEntity strips computed amounts", () => {
    const lines = lineItemsFromEntity({
      LineItems: [{ Description: "X", UnitAmount: 5, LineAmount: 5, TaxAmount: 0.5 }],
    });
    assert.equal(lines[0]?.["Description"], "X");
    assert.equal(lines[0]?.["LineAmount"], undefined);
  });
});
