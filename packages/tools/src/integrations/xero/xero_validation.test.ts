import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatXeroApiError,
  normalizeXeroLineItems,
  sanitizeInvoiceUpdate,
} from "./xero_validation.js";

describe("xero_validation", () => {
  it("normalizeXeroLineItems maps snake_case and defaults quantity", () => {
    const r = normalizeXeroLineItems([
      { description: "Widget", unit_amount: 10, account_code: "200" },
    ]);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.lineItems[0]?.["Description"], "Widget");
    assert.equal(r.lineItems[0]?.["UnitAmount"], 10);
    assert.equal(r.lineItems[0]?.["AccountCode"], "200");
    assert.equal(r.lineItems[0]?.["Quantity"], 1);
  });

  it("sanitizeInvoiceUpdate keeps only writable invoice fields", () => {
    const body = sanitizeInvoiceUpdate("id-1", {
      Status: "AUTHORISED",
      UpdatedDateUTC: "/Date(1)/",
      HasAttachments: true,
      LineItems: [{ Description: "A", UnitAmount: 5, TaxType: "NONE" }],
    });
    assert.equal(body["InvoiceID"], "id-1");
    assert.equal(body["Status"], "AUTHORISED");
    assert.equal(body["UpdatedDateUTC"], undefined);
    assert.ok(Array.isArray(body["LineItems"]));
  });

  it("formatXeroApiError surfaces ValidationErrors", () => {
    const msg = formatXeroApiError(400, {
      Message: "A validation exception occurred",
      Elements: [{ ValidationErrors: [{ Message: "Tax rate must be valid." }] }],
    }, "");
    assert.match(msg, /Tax rate must be valid/);
    assert.match(msg, /xero_set_invoice_status/);
  });
});
