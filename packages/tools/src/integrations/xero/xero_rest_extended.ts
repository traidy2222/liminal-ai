/**
 * Extended Xero Accounting API tools — reports, payments, bank, POs, quotes, settings.
 */
import type { PropertySchema, ToolRegistry, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  asToolResult,
  xeroCommonProps,
  xeroFetch,
  xeroHint,
  xeroPageParams,
  xeroPathWithQuery,
  xeroReportParams,
  xeroTenant,
} from "./xero_api.js";
import { normalizeXeroLineItems, sanitizeInvoiceUpdate } from "./xero_validation.js";

const COMMON = xeroCommonProps();

function idArg(name: string, label: string): Record<string, PropertySchema> {
  return { [name]: { type: "string", description: label } };
}

export function registerXeroRestExtendedTools(registry: ToolRegistry): void {
  registry.register(
    defineTool({
      name: "xero_get_organisation",
      description: "WHAT: Organisation profile, base currency, financial year, addresses.\nWHEN: User asks about their Xero org settings.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 120_000,
      handler: async (args): Promise<ToolResult> =>
        asToolResult(await xeroFetch("/Organisation", { accountHint: xeroHint(args), tenantId: xeroTenant(args) })),
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_accounts",
      description: "WHAT: Chart of accounts (bank, revenue, expense codes).\nWHEN: Coding invoices, bills, or journal lines.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 300_000,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/Accounts", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_account",
      description: "WHAT: Fetch one chart-of-accounts row by AccountID GUID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("account_id", "Xero AccountID (GUID).") },
        required: ["account_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["account_id"] ?? "").trim();
        if (!id) return { ok: false, error: "account_id required" };
        return asToolResult(
          await xeroFetch(`/Accounts/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_tax_rates",
      description: "WHAT: Active tax rates / GST codes for line items.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 300_000,
      handler: async (args): Promise<ToolResult> =>
        asToolResult(await xeroFetch("/TaxRates", { accountHint: xeroHint(args), tenantId: xeroTenant(args) })),
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_tracking_categories",
      description: "WHAT: Tracking categories and options (department, project dims).",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 120_000,
      handler: async (args): Promise<ToolResult> =>
        asToolResult(
          await xeroFetch("/TrackingCategories", { accountHint: xeroHint(args), tenantId: xeroTenant(args) })
        ),
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_contact",
      description: "WHAT: Fetch one contact (customer/supplier) by ContactID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("contact_id", "Xero ContactID (GUID).") },
        required: ["contact_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["contact_id"] ?? "").trim();
        if (!id) return { ok: false, error: "contact_id required" };
        return asToolResult(
          await xeroFetch(`/Contacts/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_contact",
      description:
        "WHAT: Create or update a contact (customer/supplier).\nWHEN: New customer/vendor before invoicing.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          name: { type: "string", description: "Contact display name (required)." },
          email: { type: "string" },
          is_supplier: { type: "boolean" },
          is_customer: { type: "boolean" },
          tax_number: { type: "string" },
          phones: { type: "array", items: { type: "object" } },
          addresses: { type: "array", items: { type: "object" } },
        },
        required: ["name"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const name = String(args["name"] ?? "").trim();
        if (!name) return { ok: false, error: "name required" };
        const contact: Record<string, unknown> = { Name: name };
        if (typeof args["email"] === "string" && args["email"].trim()) {
          contact["EmailAddress"] = args["email"].trim();
        }
        if (args["is_supplier"] === true) contact["IsSupplier"] = true;
        if (args["is_customer"] === true) contact["IsCustomer"] = true;
        if (typeof args["tax_number"] === "string" && args["tax_number"].trim()) {
          contact["TaxNumber"] = args["tax_number"].trim();
        }
        if (Array.isArray(args["phones"])) contact["Phones"] = args["phones"];
        if (Array.isArray(args["addresses"])) contact["Addresses"] = args["addresses"];
        return asToolResult(
          await xeroFetch("/Contacts", {
            method: "PUT",
            body: { Contacts: [contact] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_set_invoice_status",
      description:
        "WHAT: Change invoice/bill status only (DRAFT, SUBMITTED, AUTHORISED, VOIDED).\n" +
        "WHEN: Approve or void — prefer this over xero_update_invoice with a full GET payload.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("invoice_id", "Xero InvoiceID (GUID)."),
          status: {
            type: "string",
            description: "DRAFT | SUBMITTED | AUTHORISED | VOIDED",
          },
        },
        required: ["invoice_id", "status"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["invoice_id"] ?? "").trim();
        const status = String(args["status"] ?? "").trim().toUpperCase();
        if (!id || !status) return { ok: false, error: "invoice_id and status required" };
        const allowed = new Set(["DRAFT", "SUBMITTED", "AUTHORISED", "VOIDED"]);
        if (!allowed.has(status)) {
          return { ok: false, error: `status must be one of: ${[...allowed].join(", ")}` };
        }
        return asToolResult(
          await xeroFetch(`/Invoices/${encodeURIComponent(id)}`, {
            method: "POST",
            body: { Invoices: [{ InvoiceID: id, Status: status }] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_invoice",
      description:
        "WHAT: Update invoice fields (reference, due date, line items) — not status-only changes.\n" +
        "WHEN: Amend draft lines/dates. For approve/void use xero_set_invoice_status.\n" +
        "Do not pass the raw xero_get_invoice response; use explicit fields or line_items.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("invoice_id", "Xero InvoiceID (GUID)."),
          reference: { type: "string" },
          due_date: { type: "string", description: "YYYY-MM-DD" },
          date: { type: "string", description: "YYYY-MM-DD invoice date" },
          line_items: {
            type: "array",
            description: "Replacement line items (Description, UnitAmount, AccountCode, TaxType).",
            items: { type: "object" },
          },
          invoice: {
            type: "object",
            description: "Optional partial Invoice — writable fields only; read-only GET fields are stripped.",
          },
        },
        required: ["invoice_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["invoice_id"] ?? "").trim();
        if (!id) return { ok: false, error: "invoice_id required" };

        const partial: Record<string, unknown> = {};
        if (args["invoice"] && typeof args["invoice"] === "object") {
          Object.assign(partial, args["invoice"] as Record<string, unknown>);
        }
        if (typeof args["reference"] === "string" && args["reference"].trim()) {
          partial["Reference"] = args["reference"].trim();
        }
        if (typeof args["due_date"] === "string" && args["due_date"].trim()) {
          partial["DueDate"] = args["due_date"].trim();
        }
        if (typeof args["date"] === "string" && args["date"].trim()) {
          partial["Date"] = args["date"].trim();
        }
        if (Array.isArray(args["line_items"])) {
          const norm = normalizeXeroLineItems(args["line_items"]);
          if (!norm.ok) return { ok: false, error: norm.error };
          partial["LineItems"] = norm.lineItems;
        }
        if (partial["Status"] !== undefined) {
          return {
            ok: false,
            error: "use xero_set_invoice_status for status changes (avoids validation errors from GET payloads)",
          };
        }
        if (Object.keys(partial).length === 0) {
          return {
            ok: false,
            error: "provide reference, due_date, date, line_items, or a minimal invoice object",
          };
        }

        const body = sanitizeInvoiceUpdate(id, partial);
        return asToolResult(
          await xeroFetch(`/Invoices/${encodeURIComponent(id)}`, {
            method: "POST",
            body: { Invoices: [body] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_bill",
      description:
        "WHAT: Create a supplier bill (ACCPAY invoice).\nWHEN: Recording vendor invoices / accounts payable.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          contact_id: { type: "string" },
          line_items: { type: "array", items: { type: "object" } },
          reference: { type: "string" },
          due_date: { type: "string", description: "YYYY-MM-DD" },
          date: { type: "string", description: "YYYY-MM-DD invoice date" },
        },
        required: ["contact_id", "line_items"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const contactId = String(args["contact_id"] ?? "").trim();
        const lineItems = args["line_items"];
        if (!contactId || !Array.isArray(lineItems) || lineItems.length === 0) {
          return { ok: false, error: "contact_id and non-empty line_items required" };
        }
        const norm = normalizeXeroLineItems(lineItems);
        if (!norm.ok) return { ok: false, error: norm.error };
        const invoice: Record<string, unknown> = {
          Type: "ACCPAY",
          Contact: { ContactID: contactId },
          LineItems: norm.lineItems,
          Status: "DRAFT",
          LineAmountTypes: "Exclusive",
        };
        if (typeof args["reference"] === "string" && args["reference"].trim()) {
          invoice["Reference"] = args["reference"].trim();
        }
        if (typeof args["due_date"] === "string" && args["due_date"].trim()) {
          invoice["DueDate"] = args["due_date"].trim();
        }
        if (typeof args["date"] === "string" && args["date"].trim()) {
          invoice["Date"] = args["date"].trim();
        }
        return asToolResult(
          await xeroFetch("/Invoices", {
            method: "PUT",
            body: { Invoices: [invoice] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_email_invoice",
      description: "WHAT: Email an authorised sales invoice to the contact.\nWHEN: User says send invoice to customer.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("invoice_id", "Xero InvoiceID (GUID).") },
        required: ["invoice_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["invoice_id"] ?? "").trim();
        if (!id) return { ok: false, error: "invoice_id required" };
        return asToolResult(
          await xeroFetch(`/Invoices/${encodeURIComponent(id)}/Email`, {
            method: "POST",
            body: {},
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_payments",
      description: "WHAT: List payments applied to invoices/bills.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/Payments", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_payment",
      description:
        "WHAT: Record a payment against an invoice or bill.\nWHEN: Customer paid or you paid a supplier.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          invoice_id: { type: "string" },
          account_id: { type: "string", description: "Bank account AccountID." },
          amount: { type: "number" },
          date: { type: "string", description: "YYYY-MM-DD" },
          reference: { type: "string" },
        },
        required: ["invoice_id", "account_id", "amount"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const invoiceId = String(args["invoice_id"] ?? "").trim();
        const accountId = String(args["account_id"] ?? "").trim();
        const amount = Number(args["amount"]);
        if (!invoiceId || !accountId || !Number.isFinite(amount)) {
          return { ok: false, error: "invoice_id, account_id, and numeric amount required" };
        }
        const payment: Record<string, unknown> = {
          Invoice: { InvoiceID: invoiceId },
          Account: { AccountID: accountId },
          Amount: amount,
        };
        if (typeof args["date"] === "string" && args["date"].trim()) {
          payment["Date"] = args["date"].trim();
        }
        if (typeof args["reference"] === "string" && args["reference"].trim()) {
          payment["Reference"] = args["reference"].trim();
        }
        return asToolResult(
          await xeroFetch("/Payments", {
            method: "PUT",
            body: { Payments: [payment] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_bank_transactions",
      description: "WHAT: Spent/received money bank transactions (not transfers).",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/BankTransactions", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_bank_transaction",
      description:
        "WHAT: Create spent (SPEND) or received (RECEIVE) bank transaction.\n" +
        "WHEN: Use xero_list_bank_accounts for bank_account_id; contact_id recommended for SPEND.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          type: { type: "string", enum: ["SPEND", "RECEIVE"] },
          contact_id: { type: "string" },
          line_items: { type: "array", items: { type: "object" } },
          bank_account_id: { type: "string" },
          reference: { type: "string" },
        },
        required: ["type", "line_items", "bank_account_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const type = String(args["type"] ?? "").toUpperCase();
        if (type !== "SPEND" && type !== "RECEIVE") {
          return { ok: false, error: "type must be SPEND or RECEIVE" };
        }
        const lineItems = args["line_items"];
        const bankId = String(args["bank_account_id"] ?? "").trim();
        if (!Array.isArray(lineItems) || lineItems.length === 0 || !bankId) {
          return { ok: false, error: "line_items and bank_account_id required" };
        }
        const norm = normalizeXeroLineItems(lineItems);
        if (!norm.ok) return { ok: false, error: norm.error };
        const txn: Record<string, unknown> = {
          Type: type,
          LineItems: norm.lineItems,
          BankAccount: { AccountID: bankId },
        };
        const contactId = String(args["contact_id"] ?? "").trim();
        if (contactId) txn["Contact"] = { ContactID: contactId };
        if (typeof args["reference"] === "string" && args["reference"].trim()) {
          txn["Reference"] = args["reference"].trim();
        }
        return asToolResult(
          await xeroFetch("/BankTransactions", {
            method: "PUT",
            body: { BankTransactions: [txn] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_credit_notes",
      description: "WHAT: List credit notes (AR/AP adjustments).",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/CreditNotes", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_credit_note",
      description: "WHAT: Create ACCRECCREDIT or ACCPAYCREDIT credit note.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          type: { type: "string", enum: ["ACCRECCREDIT", "ACCPAYCREDIT"] },
          contact_id: { type: "string" },
          line_items: { type: "array", items: { type: "object" } },
          reference: { type: "string" },
        },
        required: ["type", "contact_id", "line_items"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const type = String(args["type"] ?? "");
        if (type !== "ACCRECCREDIT" && type !== "ACCPAYCREDIT") {
          return { ok: false, error: "type must be ACCRECCREDIT or ACCPAYCREDIT" };
        }
        const contactId = String(args["contact_id"] ?? "").trim();
        const lineItems = args["line_items"];
        if (!contactId || !Array.isArray(lineItems) || lineItems.length === 0) {
          return { ok: false, error: "contact_id and line_items required" };
        }
        const norm = normalizeXeroLineItems(lineItems);
        if (!norm.ok) return { ok: false, error: norm.error };
        const note: Record<string, unknown> = {
          Type: type,
          Contact: { ContactID: contactId },
          LineItems: norm.lineItems,
          Status: "DRAFT",
          LineAmountTypes: "Exclusive",
        };
        if (typeof args["reference"] === "string" && args["reference"].trim()) {
          note["Reference"] = args["reference"].trim();
        }
        return asToolResult(
          await xeroFetch("/CreditNotes", {
            method: "PUT",
            body: { CreditNotes: [note] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_purchase_orders",
      description: "WHAT: List purchase orders.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/PurchaseOrders", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_quotes",
      description: "WHAT: List sales quotes.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/Quotes", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_items",
      description: "WHAT: Inventory / service items catalog.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/Items", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_manual_journals",
      description: "WHAT: List manual journal entries.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/ManualJournals", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_manual_journal",
      description: "WHAT: Create a manual journal (adjusting entries).",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          narration: { type: "string" },
          journal_lines: {
            type: "array",
            description: "Lines with AccountCode, Description, LineAmount, TaxType.",
            items: { type: "object" },
          },
          date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["narration", "journal_lines"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const narration = String(args["narration"] ?? "").trim();
        const lines = args["journal_lines"];
        if (!narration || !Array.isArray(lines) || lines.length === 0) {
          return { ok: false, error: "narration and journal_lines required" };
        }
        const journal: Record<string, unknown> = {
          Narration: narration,
          JournalLines: lines,
          Status: "DRAFT",
        };
        if (typeof args["date"] === "string" && args["date"].trim()) {
          journal["Date"] = args["date"].trim();
        }
        return asToolResult(
          await xeroFetch("/ManualJournals", {
            method: "PUT",
            body: { ManualJournals: [journal] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  const reportTool = (
    name: string,
    path: string,
    description: string,
    extraProps: Record<string, PropertySchema> = {}
  ) => {
    registry.register(
      defineTool({
        name,
        description,
        parameters: {
          type: "object",
          properties: {
            ...COMMON,
            fromDate: { type: "string", description: "YYYY-MM-DD" },
            toDate: { type: "string", description: "YYYY-MM-DD" },
            date: { type: "string", description: "Report as-at date YYYY-MM-DD" },
            periods: { type: "number" },
            timeframe: { type: "string", description: "MONTH, QUARTER, YEAR" },
            contact_id: { type: "string", description: "For aged reports — ContactID." },
            ...extraProps,
          },
          additionalProperties: false,
        },
        requiresApproval: false,
        cacheable: true,
        cacheTtlMs: 60_000,
        handler: async (args): Promise<ToolResult> => {
          const params = xeroReportParams(args);
          if (typeof args["contact_id"] === "string" && args["contact_id"].trim()) {
            params.set("contactID", args["contact_id"].trim());
          }
          return asToolResult(
            await xeroFetch(xeroPathWithQuery(path, params), {
              accountHint: xeroHint(args),
              tenantId: xeroTenant(args),
            })
          );
        },
      })
    );
  };

  reportTool(
    "xero_report_profit_and_loss",
    "/Reports/ProfitAndLoss",
    "WHAT: Profit & Loss report.\nWHEN: Revenue, expenses, net profit for a period."
  );
  reportTool(
    "xero_report_balance_sheet",
    "/Reports/BalanceSheet",
    "WHAT: Balance sheet report.\nWHEN: Assets, liabilities, equity snapshot."
  );
  reportTool(
    "xero_report_trial_balance",
    "/Reports/TrialBalance",
    "WHAT: Trial balance.\nWHEN: Period-end GL tie-out."
  );
  reportTool(
    "xero_report_aged_receivables",
    "/Reports/AgedReceivablesByContact",
    "WHAT: Aged receivables by contact.\nWHEN: Who owes you money."
  );
  reportTool(
    "xero_report_aged_payables",
    "/Reports/AgedPayablesByContact",
    "WHAT: Aged payables by contact.\nWHEN: What you owe suppliers."
  );
  reportTool(
    "xero_report_bank_summary",
    "/Reports/BankSummary",
    "WHAT: Bank account summary balances.\nWHEN: Cash position overview."
  );
  reportTool(
    "xero_report_executive_summary",
    "/Reports/ExecutiveSummary",
    "WHAT: Executive summary dashboard metrics."
  );

  registry.register(
    defineTool({
      name: "xero_request",
      description:
        "WHAT: Raw Xero Accounting API call (escape hatch).\n" +
        "WHEN: Endpoint not covered by a named tool — path under /api.xro/2.0 e.g. /Budgets or /LinkedTransactions.\n" +
        "Use GET for reads; PUT/POST for writes (approval-gated).",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          method: { type: "string", enum: ["GET", "PUT", "POST", "DELETE"] },
          path: { type: "string", description: "e.g. /Quotes/{id} or /RepeatingInvoices" },
          body: { type: "object", description: "JSON body for PUT/POST." },
        },
        required: ["method", "path"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const method = String(args["method"] ?? "GET").toUpperCase();
        const path = String(args["path"] ?? "").trim();
        if (!path.startsWith("/")) return { ok: false, error: "path must start with /" };
        const body = args["body"];
        return asToolResult(
          await xeroFetch(path, {
            method,
            body: body !== undefined ? body : undefined,
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

}
