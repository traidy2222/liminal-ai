import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ToolRegistry,
  SignatureWorkflowRun,
  runWithWorkspaceRoot,
} from "@liminal/core";
import { registerXeroRestExtendedTools } from "./xero_rest_extended.js";
import { registerXeroRestPhase2Tools } from "./xero_rest_phase2.js";
test("receipt review reaches actual Xero tool adapters as a DRAFT with correct currency and source bytes; retry never creates a second bill", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-xero-draft-"));
  const id = "12345678-1234-1234-1234-123456789abc";
  try {
    await runWithWorkspaceRoot(root, async () => {
      await writeFile(path.join(root, "receipt.png"), "synthetic-source");
      const run = new SignatureWorkflowRun(
        root,
        "receipt_to_xero",
        "Synthetic expense",
        ["receipt.png"],
      );
      await run.initialize();
      run.observe(
        "receipt_read",
        {},
        { ok: true, output: "Synthetic test OCR: AUD 55 tax 5" },
      );
      await run.deliver("review", {
        merchant: "Example Office Supply",
        date: "2026-11-02",
        currency: "AUD",
        total: 55,
        tax: 5,
        lines: [
          {
            description: "Paper",
            quantity: 2,
            unit_price: 25,
            tax_amount: 5,
            account_code: "453",
          },
        ],
      });
      const registry = new ToolRegistry();
      let creates = 0;
      let attempts = 0;
      registerXeroRestExtendedTools(registry, async (api, opts) => {
        assert.equal(api, "/Invoices");
        assert.equal(opts?.method, "PUT");
        const invoice = (opts?.body as { Invoices: Record<string, unknown>[] })
          .Invoices[0]!;
        assert.equal(invoice.Type, "ACCPAY");
        assert.equal(invoice.Status, "DRAFT");
        assert.equal(invoice.CurrencyCode, "AUD");
        assert.equal(invoice.LineAmountTypes, "Exclusive");
        creates++;
        return {
          ok: true,
          data: { Invoices: [{ ...invoice, InvoiceID: id, Total: 55 }] },
        };
      });
      registerXeroRestPhase2Tools(
        registry,
        async (parent, invoiceId, fileName, bytes) => {
          assert.equal(parent, "Invoices");
          assert.equal(invoiceId, id);
          assert.equal(fileName, "receipt.png");
          assert.equal(bytes.toString(), "synthetic-source");
          attempts++;
          return attempts === 1
            ? { ok: false, error: "Simulated connection interruption" }
            : { ok: true, data: { Attachments: [{ FileName: fileName }] } };
        },
      );
      const bill = registry.get("xero_create_bill")!;
      assert.equal(bill.requiresApproval, true);
      assert.equal(bill.dangerLevel, "destructive");
      run.observe(
        "xero_list_accounts",
        {},
        {
          ok: true,
          output: JSON.stringify({
            Accounts: [{ Code: "453", Status: "ACTIVE" }],
          }),
        },
      );
      run.observe(
        "xero_list_tax_rates",
        {},
        {
          ok: true,
          output: JSON.stringify({
            TaxRates: [{ TaxType: "INPUT", Status: "ACTIVE" }],
          }),
        },
      );
      const args = {
        contact_id: "supplier",
        currency_code: "AUD",
        date: "2026-11-02",
        line_items: [
          {
            Description: "Paper",
            Quantity: 2,
            UnitAmount: 25,
            AccountCode: "453",
            TaxType: "INPUT",
          },
        ],
      };
      run.observe(
        "xero_duplicate_invoice_check",
        { contact_id: "supplier", type: "ACCPAY", amount: 55 },
        {
          ok: true,
          output: JSON.stringify({ match_count: 0, likely_duplicates: [] }),
        },
      );
      assert.equal(run.guard(bill.name, args), null);
      const created = await bill.handler(args);
      assert.equal(created.ok, true);
      run.observe(bill.name, args, created);
      const upload = registry.get("xero_upload_attachment")!;
      const attachment = {
        parent_type: "Invoices",
        parent_id: id,
        file_path: "receipt.png",
      };
      const failed = await upload.handler(attachment);
      assert.equal(failed.ok, false);
      run.observe(upload.name, attachment, failed);
      await assert.rejects(
        run.deliver("complete", {}),
        /attachment is missing/,
      );
      const resumed = await SignatureWorkflowRun.resume(root, run.id);
      assert.match(resumed.guard(bill.name, args)!, /already created/);
      const retried = await upload.handler(attachment);
      assert.equal(retried.ok, true);
      resumed.observe(upload.name, attachment, retried);
      assert.equal(
        (await resumed.deliver("complete", {})).status,
        "draft_created",
      );
      assert.equal(creates, 1);
      assert.equal(attempts, 2);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
