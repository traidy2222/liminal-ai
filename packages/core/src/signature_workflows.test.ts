import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SignatureWorkflowRun,
  validateExpenseReview,
  parseSignatureCommand,
} from "./signature_workflows.js";
const review = {
  merchant: "Example Office Supply",
  date: "2026-11-02",
  currency: "AUD",
  total: 55,
  tax: 5,
  lines: [
    {
      description: "Printer paper",
      quantity: 2,
      unit_price: 25,
      tax_amount: 5,
      account_code: "453",
    },
  ],
};
async function fixture(
  preset: "enquiry_to_proposal" | "receipt_to_xero" | "bugfix_to_handoff",
  fn: (r: SignatureWorkflowRun, root: string) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-work-"));
  try {
    const source = path.join(root, "receipt.png");
    await writeFile(source, "test-source");
    const r = new SignatureWorkflowRun(
      root,
      preset,
      "Synthetic test input",
      preset === "receipt_to_xero" ? [source] : [],
    );
    await r.initialize();
    await fn(r, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("proposal requires observed research and writes an unsent draft plus sources", () =>
  fixture("enquiry_to_proposal", async (r) => {
    const d = {
      client: "Example client <script>bad()</script>",
      subject: "Website proposal",
      proposal: "Scope: accessible contact form. Pricing: to be agreed.",
      reply: "Here is a draft scope for review.",
      sources: [{ url: "https://www.w3.org/WAI/", title: "W3C accessibility" }],
    };
    await assert.rejects(r.deliver("complete", d), /not observed/);
    r.observe(
      "web_fetch",
      { url: d.sources[0].url },
      { ok: true, output: "W3C WAI guidance" },
    );
    assert.equal(r.guard("gmail_send_email", {}) !== null, true);
    const result = await r.deliver("complete", d);
    assert.equal(result.status, "ready_for_review");
    assert.match(
      await readFile(path.join(r.directory, "reply-draft.eml"), "utf8"),
      /^X-Unsent: 1/,
    );
    assert.match(
      await readFile(path.join(r.directory, "proposal.md"), "utf8"),
      /Pricing: to be agreed/,
    );
    const html = await readFile(
      path.join(r.directory, "proposal.html"),
      "utf8",
    );
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    await assert.rejects(
      r.deliver("complete", {
        ...d,
        subject: "ok\r\nBcc: injected@example.com",
      }),
      /single line/,
    );
  }));
test("receipt rejects unreconciled amounts and blocks writes until review and a conclusive matching duplicate check", () =>
  fixture("receipt_to_xero", async (r) => {
    assert.throws(
      () => validateExpenseReview({ ...review, total: 56 }),
      /reconcile/,
    );
    assert.throws(
      () => validateExpenseReview({ ...review, currency: "ZZZ" }),
      /currency/,
    );
    assert.throws(
      () => validateExpenseReview({ ...review, date: "2026-02-31" }),
      /valid/,
    );
    await assert.rejects(r.deliver("review", review), /receipt_read/);
    assert.match(r.guard("xero_create_bill", {})!, /review/);
    r.observe(
      "receipt_read",
      {},
      { ok: true, output: "Example Office Supply AUD 55.00 tax 5.00" },
    );
    await r.deliver("review", review);
    r.observe(
      "xero_list_accounts",
      {},
      {
        ok: true,
        output: JSON.stringify({
          Accounts: [{ Code: "453", Status: "ACTIVE" }],
        }),
      },
    );
    r.observe(
      "xero_list_tax_rates",
      {},
      {
        ok: true,
        output: JSON.stringify({
          TaxRates: [{ TaxType: "INPUT", Status: "ACTIVE" }],
        }),
      },
    );
    const bill = {
      contact_id: "supplier",
      date: review.date,
      currency_code: "AUD",
      line_items: [
        { Quantity: 2, UnitAmount: 25, AccountCode: "453", TaxType: "INPUT" },
      ],
    };
    assert.match(r.guard("xero_create_bill", bill)!, /duplicate check/);
    r.observe(
      "xero_duplicate_invoice_check",
      { contact_id: "supplier", type: "ACCPAY", amount: 55 },
      {
        ok: true,
        output: JSON.stringify({
          match_count: 1,
          likely_duplicates: [{ InvoiceID: "existing" }],
        }),
      },
    );
    assert.match(r.guard("xero_create_bill", bill)!, /Duplicate check/);
    r.observe(
      "xero_duplicate_invoice_check",
      { contact_id: "supplier", type: "ACCPAY", amount: 55 },
      {
        ok: true,
        output: JSON.stringify({ match_count: 0, likely_duplicates: [] }),
      },
    );
    assert.match(
      r.guard("xero_create_bill", {
        ...bill,
        line_items: [{ ...bill.line_items[0], AccountCode: "invented" }],
      })!,
      /observed active account/,
    );
    assert.match(
      r.guard("xero_create_bill", {
        ...bill,
        line_items: [{ ...bill.line_items[0], TaxType: "invented" }],
      })!,
      /observed active tax/,
    );
    assert.equal(r.guard("xero_create_bill", bill), null);
    assert.match(r.guard("xero_create_bill", bill)!, /already in progress/);
    assert.match(
      r.guard("xero_create_bill", { ...bill, currency_code: "USD" })!,
      /currency/,
    );
    assert.notEqual(r.guard("xero_create_payment", {}), null);
    r.observe("xero_create_bill", bill, {
      ok: true,
      output: JSON.stringify({
        Invoices: [
          {
            InvoiceID: "draft-123",
            Status: "DRAFT",
            CurrencyCode: "AUD",
            Total: 55,
          },
        ],
      }),
    });
    await assert.rejects(r.deliver("complete", {}), /attachment is missing/);
    assert.match(r.guard("xero_create_bill", bill)!, /already created/);
    r.observe(
      "xero_upload_attachment",
      { parent_id: "wrong-bill" },
      { ok: true, output: "uploaded" },
    );
    await assert.rejects(r.deliver("complete", {}), /attachment is missing/);
    r.observe(
      "xero_upload_attachment",
      {
        parent_type: "Invoices",
        parent_id: "draft-123",
        file_path: "receipt.png",
      },
      { ok: true, output: "uploaded receipt.png" },
    );
    assert.equal((await r.deliver("complete", {})).status, "draft_created");
    assert.equal(
      JSON.parse(
        await readFile(path.join(r.directory, "xero-handoff.json"), "utf8"),
      ).invoiceId,
      "draft-123",
    );
  }));
test("patch requires reproduction, post-edit passing tests, and an actual diff; later edits invalidate verification", () =>
  fixture("bugfix_to_handoff", async (r, root) => {
    await writeFile(path.join(root, "fix.js"), "fixed");
    const data = {
      summary: "Fixed the defect",
      changes: ["fix.js"],
      verification: "Regression test passes",
      limitations: "Focused test only",
    };
    await assert.rejects(r.deliver("complete", data), /Reproduce/);
    r.observe(
      "run_tests",
      { cwd: root },
      { ok: false, error: "exit 1: AssertionError regression failed" },
    );
    r.observe("edit_file", { path: "fix.js" }, { ok: true, output: "edited" });
    await assert.rejects(r.deliver("complete", data), /passing test/);
    r.observe(
      "run_tests",
      { cwd: root },
      {
        ok: true,
        output: "TAP version 13\n# tests 1\n# pass 1\n# fail 0\n# skipped 0",
      },
    );
    r.observe(
      "git_diff",
      { cwd: root },
      { ok: true, output: "diff --git a/fix.js b/fix.js\n-old\n+fixed" },
    );
    assert.equal((await r.deliver("complete", data)).status, "verified_patch");
    r.observe(
      "run_tests",
      { cwd: root },
      { ok: false, error: "Regression failed again" },
    );
    await assert.rejects(r.deliver("complete", data), /passing test/);
    r.observe(
      "edit_file",
      { path: "fix.js" },
      { ok: true, output: "edited again" },
    );
    await assert.rejects(r.deliver("complete", data), /passing test/);
  }));
test("parallel file edit and verification cannot produce a passing workflow gate", () =>
  fixture("bugfix_to_handoff", async (r, root) => {
    await writeFile(path.join(root, "fix.js"), "fixed");
    r.observe(
      "run_tests",
      {},
      { ok: false, error: "exit 1: test assertion failed" },
    );
    r.start("edit_file", "edit");
    r.start("run_tests", "tests");
    r.observe("edit_file", {}, { ok: true, output: "edited" }, "edit");
    r.observe("run_tests", {}, { ok: true, output: "1 passed" }, "tests");
    r.observe(
      "git_diff",
      {},
      { ok: true, output: "diff --git a/fix.js b/fix.js" },
    );
    await assert.rejects(
      r.deliver("complete", {
        summary: "fix",
        changes: ["fix.js"],
        verification: "test",
        limitations: "none",
      }),
      /passing test/,
    );
  }));
test("workflow commands preserve multiline enquiries and bug reports", () => {
  assert.deepEqual(parseSignatureCommand("/proposal First line\nSecond line"), {
    preset: "enquiry_to_proposal",
    note: "First line\nSecond line",
  });
  assert.equal(
    parseSignatureCommand("/fix bad total")?.preset,
    "bugfix_to_handoff",
  );
});

test("receipt recovery rejects modified source bytes", () =>
  fixture("receipt_to_xero", async (r, root) => {
    r.observe(
      "receipt_read",
      {},
      { ok: true, output: "Read original receipt" },
    );
    await r.deliver("review", review);
    assert.equal(
      (await SignatureWorkflowRun.resume(root, r.id)).status,
      "ready_for_review",
    );
    assert.equal((await SignatureWorkflowRun.list(root))[0]?.id, r.id);
    await writeFile(path.join(root, "receipt.png"), "different receipt");
    await assert.rejects(
      SignatureWorkflowRun.resume(root, r.id),
      /source has changed/,
    );
    await assert.rejects(r.deliver("review", review), /source has changed/);
  }));
test("resumed patches require fresh verification and cannot reuse an older pass", () =>
  fixture("bugfix_to_handoff", async (r, root) => {
    await writeFile(path.join(root, "fix.js"), "fixed");
    const data = {
      summary: "Fix",
      changes: ["fix.js"],
      verification: "Regression passes",
      limitations: "Focused fixture",
    };
    r.observe(
      "run_tests",
      { cwd: root },
      { ok: false, error: "AssertionError regression failed" },
    );
    r.observe("edit_file", {}, { ok: true, output: "edited" });
    r.observe(
      "run_tests",
      { cwd: root },
      { ok: true, output: "# tests 1\n# pass 1" },
    );
    r.observe(
      "git_diff",
      { cwd: root },
      { ok: true, output: "diff --git a/fix.js b/fix.js" },
    );
    await r.deliver("complete", data);
    const resumed = await SignatureWorkflowRun.resume(root, r.id);
    await assert.rejects(resumed.deliver("complete", data), /passing test/);
    resumed.observe(
      "run_tests",
      { cwd: root },
      { ok: true, output: "# tests 1\n# pass 1" },
    );
    resumed.observe(
      "git_diff",
      { cwd: root },
      { ok: true, output: "diff --git a/fix.js b/fix.js" },
    );
    assert.equal(
      (await resumed.deliver("complete", data)).status,
      "verified_patch",
    );
  }));
