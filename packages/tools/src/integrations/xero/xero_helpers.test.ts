import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateProjectTimeByTask,
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

  it("aggregateProjectTimeByTask groups minutes by task with rates", () => {
    const tasks = new Map<string, Record<string, unknown>>([
      ["t1", { name: "Design", rate: { value: 120 } }],
    ]);
    const agg = aggregateProjectTimeByTask(
      [
        { taskId: "t1", duration: 90, dateUtc: "2024-06-01T10:00:00Z", status: "ACTIVE" },
        { taskId: "t1", duration: 30, dateUtc: "2024-06-02T10:00:00Z", status: "ACTIVE" },
        { taskId: "t1", duration: 60, dateUtc: "2024-05-01T10:00:00Z", status: "INVOICED" },
      ],
      tasks,
      { fromDate: "2024-06-01", toDate: "2024-06-30" }
    );
    assert.equal(agg.ok, true);
    if (!agg.ok) return;
    assert.equal(agg.totalMinutes, 120);
    assert.equal(agg.lineItems.length, 1);
    assert.equal(agg.lineItems[0]?.["UnitAmount"], 120);
    assert.equal(agg.lineItems[0]?.["Quantity"], 2);
  });
});
