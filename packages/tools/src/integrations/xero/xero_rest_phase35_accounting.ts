/**
 * Xero Phase 3.5 — accounting mutations: bank txns, COA, tracking, expenses, budgets, reminders.
 */
import type { PropertySchema, ToolRegistry, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  asToolResult,
  jsonOutput,
  xeroCommonProps,
  xeroFetch,
  xeroHint,
  xeroPageParams,
  xeroPathWithQuery,
  xeroTenant,
} from "./xero_api.js";
import { normalizeXeroLineItems } from "./xero_validation.js";

const COMMON = xeroCommonProps();

function idArg(name: string, label: string): Record<string, PropertySchema> {
  return { [name]: { type: "string", description: label } };
}

export function registerXeroPhase35AccountingTools(registry: ToolRegistry): void {
  registry.register(
    defineTool({
      name: "xero_update_bank_transaction",
      description:
        "WHAT: Update line items or reference on a bank transaction.\n" +
        "WHEN: Fix coding mistakes — pass bank_transaction_id + fields to change.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("bank_transaction_id", "BankTransactionID GUID."),
          line_items: { type: "array", items: { type: "object" } },
          reference: { type: "string" },
        },
        required: ["bank_transaction_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["bank_transaction_id"] ?? "").trim();
        if (!id) return { ok: false, error: "bank_transaction_id required" };
        const txn: Record<string, unknown> = { BankTransactionID: id };
        if (Array.isArray(args["line_items"])) {
          const norm = normalizeXeroLineItems(args["line_items"]);
          if (!norm.ok) return { ok: false, error: norm.error };
          txn["LineItems"] = norm.lineItems;
        }
        if (typeof args["reference"] === "string" && args["reference"].trim()) {
          txn["Reference"] = args["reference"].trim();
        }
        if (Object.keys(txn).length === 1) {
          return { ok: false, error: "provide line_items and/or reference" };
        }
        return asToolResult(
          await xeroFetch(`/BankTransactions/${encodeURIComponent(id)}`, {
            method: "POST",
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
      name: "xero_void_bank_transaction",
      description: "WHAT: Void a bank transaction.\nWHEN: Remove a mistaken spend/receive line.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("bank_transaction_id", "BankTransactionID GUID.") },
        required: ["bank_transaction_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["bank_transaction_id"] ?? "").trim();
        if (!id) return { ok: false, error: "bank_transaction_id required" };
        return asToolResult(
          await xeroFetch(`/BankTransactions/${encodeURIComponent(id)}`, {
            method: "POST",
            body: { BankTransactions: [{ BankTransactionID: id, Status: "DELETED" }] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_account",
      description:
        "WHAT: Add a chart-of-accounts code.\n" +
        "WHEN: New revenue/expense/asset account — requires accounting.settings scope.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          code: { type: "string" },
          name: { type: "string" },
          type: {
            type: "string",
            description: "REVENUE, EXPENSE, BANK, CURRENT, FIXED, etc.",
          },
          tax_type: { type: "string" },
        },
        required: ["code", "name", "type"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const code = String(args["code"] ?? "").trim();
        const name = String(args["name"] ?? "").trim();
        const type = String(args["type"] ?? "").trim();
        if (!code || !name || !type) return { ok: false, error: "code, name, type required" };
        const account: Record<string, unknown> = { Code: code, Name: name, Type: type };
        if (typeof args["tax_type"] === "string" && args["tax_type"].trim()) {
          account["TaxType"] = args["tax_type"].trim();
        }
        return asToolResult(
          await xeroFetch("/Accounts", {
            method: "PUT",
            body: { Accounts: [account] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_account",
      description: "WHAT: Update account name, code, or status.\nWHEN: Rename or disable a COA line.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("account_id", "AccountID GUID."),
          code: { type: "string" },
          name: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "ARCHIVED"] },
        },
        required: ["account_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["account_id"] ?? "").trim();
        if (!id) return { ok: false, error: "account_id required" };
        const account: Record<string, unknown> = { AccountID: id };
        if (typeof args["code"] === "string" && args["code"].trim()) account["Code"] = args["code"].trim();
        if (typeof args["name"] === "string" && args["name"].trim()) account["Name"] = args["name"].trim();
        if (typeof args["status"] === "string") account["Status"] = args["status"];
        if (Object.keys(account).length === 1) {
          return { ok: false, error: "provide code, name, and/or status" };
        }
        return asToolResult(
          await xeroFetch("/Accounts", {
            method: "POST",
            body: { Accounts: [account] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_tracking_category",
      description: "WHAT: Create a tracking category (department, cost centre).\nWHEN: New tracking dimension.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          name: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const name = String(args["name"] ?? "").trim();
        if (!name) return { ok: false, error: "name required" };
        return asToolResult(
          await xeroFetch("/TrackingCategories", {
            method: "PUT",
            body: { TrackingCategories: [{ Name: name }] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_tracking_option",
      description: "WHAT: Add an option to a tracking category.\nWHEN: New department/location value.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("tracking_category_id", "TrackingCategoryID GUID."),
          name: { type: "string", description: "Option label." },
        },
        required: ["tracking_category_id", "name"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const catId = String(args["tracking_category_id"] ?? "").trim();
        const name = String(args["name"] ?? "").trim();
        if (!catId || !name) return { ok: false, error: "tracking_category_id and name required" };
        return asToolResult(
          await xeroFetch(`/TrackingCategories/${encodeURIComponent(catId)}/Options`, {
            method: "PUT",
            body: { Options: [{ Name: name }] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_tracking_category",
      description: "WHAT: Rename or archive a tracking category or option.\nWHEN: Reorganise tracking.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("tracking_category_id", "TrackingCategoryID GUID."),
          name: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "ARCHIVED"] },
        },
        required: ["tracking_category_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["tracking_category_id"] ?? "").trim();
        if (!id) return { ok: false, error: "tracking_category_id required" };
        const cat: Record<string, unknown> = { TrackingCategoryID: id };
        if (typeof args["name"] === "string" && args["name"].trim()) cat["Name"] = args["name"].trim();
        if (typeof args["status"] === "string") cat["Status"] = args["status"];
        if (Object.keys(cat).length === 1) {
          return { ok: false, error: "provide name and/or status" };
        }
        return asToolResult(
          await xeroFetch(`/TrackingCategories/${encodeURIComponent(id)}`, {
            method: "POST",
            body: { TrackingCategories: [cat] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_expense_claims",
      description: "WHAT: List staff expense claims.\nWHEN: Reimbursement review.",
      parameters: {
        type: "object",
        properties: { ...COMMON },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/ExpenseClaims", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_expense_claim",
      description: "WHAT: Fetch one expense claim by ExpenseClaimID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("expense_claim_id", "ExpenseClaimID GUID.") },
        required: ["expense_claim_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["expense_claim_id"] ?? "").trim();
        if (!id) return { ok: false, error: "expense_claim_id required" };
        return asToolResult(
          await xeroFetch(`/ExpenseClaims/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_expense_claim",
      description:
        "WHAT: Create or submit an expense claim.\n" +
        "WHEN: Staff reimbursement — pass user_id (Xero user) and receipt line items.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          user_id: { type: "string", description: "Xero UserID of claimant." },
          receipt_lines: {
            type: "array",
            description: "Receipt line objects per Xero API (Description, UnitAmount, AccountCode, etc.).",
            items: { type: "object" },
          },
          status: {
            type: "string",
            enum: ["SUBMITTED", "AUTHORISED", "PAID"],
            description: "Default SUBMITTED.",
          },
        },
        required: ["user_id", "receipt_lines"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const userId = String(args["user_id"] ?? "").trim();
        const lines = args["receipt_lines"];
        if (!userId || !Array.isArray(lines) || lines.length === 0) {
          return { ok: false, error: "user_id and receipt_lines required" };
        }
        const norm = normalizeXeroLineItems(lines);
        if (!norm.ok) return { ok: false, error: norm.error };
        const status =
          typeof args["status"] === "string" ? args["status"].trim().toUpperCase() : "SUBMITTED";
        const claim: Record<string, unknown> = {
          User: { UserID: userId },
          Status: status,
          Receipts: [{ ReceiptLines: norm.lineItems }],
        };
        return asToolResult(
          await xeroFetch("/ExpenseClaims", {
            method: "PUT",
            body: { ExpenseClaims: [claim] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_repeating_invoice",
      description: "WHAT: Update a repeating invoice template.\nWHEN: Change schedule or lines on recurring billing.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("repeating_invoice_id", "RepeatingInvoiceID GUID."),
          repeating_invoice: {
            type: "object",
            description: "Partial RepeatingInvoice merged with ID.",
          },
        },
        required: ["repeating_invoice_id", "repeating_invoice"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["repeating_invoice_id"] ?? "").trim();
        const payload = args["repeating_invoice"];
        if (!id || !payload || typeof payload !== "object") {
          return { ok: false, error: "repeating_invoice_id and repeating_invoice required" };
        }
        const merged = { ...(payload as Record<string, unknown>), RepeatingInvoiceID: id };
        return asToolResult(
          await xeroFetch(`/RepeatingInvoices/${encodeURIComponent(id)}`, {
            method: "POST",
            body: { RepeatingInvoices: [merged] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_delete_repeating_invoice",
      description: "WHAT: Delete (archive) a repeating invoice template.\nWHEN: Stop recurring billing.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("repeating_invoice_id", "RepeatingInvoiceID GUID.") },
        required: ["repeating_invoice_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["repeating_invoice_id"] ?? "").trim();
        if (!id) return { ok: false, error: "repeating_invoice_id required" };
        return asToolResult(
          await xeroFetch(`/RepeatingInvoices/${encodeURIComponent(id)}`, {
            method: "POST",
            body: { RepeatingInvoices: [{ RepeatingInvoiceID: id, Status: "DELETED" }] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_send_invoice_reminder",
      description:
        "WHAT: Send a payment reminder email for an outstanding sales invoice.\n" +
        "WHEN: Chase overdue debtors — invoice must be AUTHORISED.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("invoice_id", "InvoiceID GUID.") },
        required: ["invoice_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["invoice_id"] ?? "").trim();
        if (!id) return { ok: false, error: "invoice_id required" };
        const opts = { accountHint: xeroHint(args), tenantId: xeroTenant(args) };
        const r = await xeroFetch(`/Invoices/${encodeURIComponent(id)}/Reminders`, {
          method: "POST",
          body: {},
          ...opts,
        });
        if (!r.ok) return r;
        return {
          ok: true,
          output: jsonOutput({ invoice_id: id, reminder_sent: true }),
        };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_budgets",
      description: "WHAT: List budgets for variance analysis.\nWHEN: Budget vs actual review.",
      parameters: {
        type: "object",
        properties: { ...COMMON, date: { type: "string", description: "YYYY-MM-DD as at date." } },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = new URLSearchParams();
        if (typeof args["date"] === "string" && args["date"].trim()) {
          params.set("Date", args["date"].trim());
        }
        const q = params.toString();
        return asToolResult(
          await xeroFetch(q ? `/Budgets?${q}` : "/Budgets", {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_budget",
      description: "WHAT: Fetch one budget by BudgetID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("budget_id", "BudgetID GUID.") },
        required: ["budget_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["budget_id"] ?? "").trim();
        if (!id) return { ok: false, error: "budget_id required" };
        return asToolResult(
          await xeroFetch(`/Budgets/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );
}
