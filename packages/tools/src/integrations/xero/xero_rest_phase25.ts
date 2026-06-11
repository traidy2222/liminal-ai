/**
 * Xero Phase 2.5 — lifecycle updates, allocations, ergonomics, composites, tax reports.
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
  xeroReportParams,
  xeroTenant,
  isXeroAttachmentParent,
} from "./xero_api.js";
import {
  contactIdFromEntity,
  filterBankAccounts,
  lineItemsFromEntity,
  pickDefaultPurchaseLineDefaults,
  pickDefaultSalesLineDefaults,
  xeroEntityArray,
  xeroFetchEntity,
  xeroFirstEntity,
} from "./xero_helpers.js";
import {
  normalizeXeroLineItems,
  sanitizeContactUpdate,
  sanitizeCreditNoteUpdate,
  sanitizePurchaseOrderUpdate,
  sanitizeQuoteUpdate,
  todayXeroDate,
} from "./xero_validation.js";

const COMMON = xeroCommonProps();

function idArg(name: string, label: string): Record<string, PropertySchema> {
  return { [name]: { type: "string", description: label } };
}

function lineItemsProp(desc: string): PropertySchema {
  return {
    type: "array",
    description: desc,
    items: { type: "object" },
  };
}

export function registerXeroRestPhase25Tools(registry: ToolRegistry): void {
  registry.register(
    defineTool({
      name: "xero_find_contact",
      description:
        "WHAT: Search contacts by name or email (customers/suppliers).\n" +
        "WHEN: Before create_contact — avoid duplicates; find ContactID for invoices.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          query: { type: "string", description: "Name or email substring to search." },
          is_customer: { type: "boolean" },
          is_supplier: { type: "boolean" },
          limit: { type: "number", description: "Max results (default 20)." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 30_000,
      handler: async (args): Promise<ToolResult> => {
        const q = String(args["query"] ?? "").trim();
        if (!q) return { ok: false, error: "query required" };
        const escaped = q.replace(/"/g, '\\"');
        const params = new URLSearchParams();
        params.set("where", `Name.Contains("${escaped}") || EmailAddress.Contains("${escaped}")`);
        const r = await xeroFetch(xeroPathWithQuery("/Contacts", params), {
          accountHint: xeroHint(args),
          tenantId: xeroTenant(args),
        });
        if (!r.ok) return r;
        let contacts = xeroEntityArray(r.data, "Contacts");
        if (args["is_customer"] === true) {
          contacts = contacts.filter((c) => c["IsCustomer"] === true);
        }
        if (args["is_supplier"] === true) {
          contacts = contacts.filter((c) => c["IsSupplier"] === true);
        }
        const limit = typeof args["limit"] === "number" && args["limit"] > 0 ? Math.floor(args["limit"]) : 20;
        const slim = contacts.slice(0, limit).map((c) => ({
          ContactID: c["ContactID"],
          Name: c["Name"],
          EmailAddress: c["EmailAddress"],
          IsCustomer: c["IsCustomer"],
          IsSupplier: c["IsSupplier"],
        }));
        return { ok: true, output: jsonOutput({ count: slim.length, contacts: slim }) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_bank_accounts",
      description:
        "WHAT: Bank accounts only (Type=BANK) for payments and bank transactions.\n" +
        "WHEN: Before xero_create_payment or xero_create_bank_transaction — use AccountID here.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 120_000,
      handler: async (args): Promise<ToolResult> => {
        const params = new URLSearchParams();
        params.set("where", 'Type=="BANK"');
        const r = await xeroFetch(xeroPathWithQuery("/Accounts", params), {
          accountHint: xeroHint(args),
          tenantId: xeroTenant(args),
        });
        if (!r.ok) return r;
        const banks = filterBankAccounts(xeroEntityArray(r.data, "Accounts"));
        const slim = banks.map((a) => ({
          AccountID: a["AccountID"],
          Code: a["Code"],
          Name: a["Name"],
          CurrencyCode: a["CurrencyCode"],
          Status: a["Status"],
        }));
        return { ok: true, output: jsonOutput({ count: slim.length, bank_accounts: slim }) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_suggest_line_item",
      description:
        "WHAT: Suggest default AccountCode + TaxType for sales or purchase line items.\n" +
        "WHEN: Before create invoice/bill/quote — reduces 400 validation errors.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          kind: { type: "string", enum: ["sales", "purchase"], description: "sales=ACCREC/revenue; purchase=ACCPAY/expense." },
        },
        required: ["kind"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 300_000,
      handler: async (args): Promise<ToolResult> => {
        const kind = String(args["kind"] ?? "").toLowerCase();
        if (kind !== "sales" && kind !== "purchase") {
          return { ok: false, error: "kind must be sales or purchase" };
        }
        const opts = { accountHint: xeroHint(args), tenantId: xeroTenant(args) };
        const [acctR, taxR] = await Promise.all([
          xeroFetch("/Accounts", opts),
          xeroFetch("/TaxRates", opts),
        ]);
        if (!acctR.ok) return acctR;
        if (!taxR.ok) return taxR;
        const accounts = xeroEntityArray(acctR.data, "Accounts");
        const taxRates = xeroEntityArray(taxR.data, "TaxRates");
        const defaults =
          kind === "sales"
            ? pickDefaultSalesLineDefaults(accounts, taxRates)
            : pickDefaultPurchaseLineDefaults(accounts, taxRates);
        return {
          ok: true,
          output: jsonOutput({
            kind,
            suggested_line_item: {
              Description: "(your description)",
              Quantity: 1,
              UnitAmount: 0,
              AccountCode: defaults.accountCode,
              TaxType: defaults.taxType,
            },
            note: "Call xero_list_accounts / xero_list_tax_rates if these defaults are empty or wrong for your org.",
          }),
        };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_contact",
      description: "WHAT: Update an existing contact (name, email, phone, address).\nWHEN: Fix typos or add details.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("contact_id", "ContactID GUID."),
          name: { type: "string" },
          email: { type: "string" },
          is_customer: { type: "boolean" },
          is_supplier: { type: "boolean" },
          tax_number: { type: "string" },
          phones: { type: "array", items: { type: "object" } },
          addresses: { type: "array", items: { type: "object" } },
        },
        required: ["contact_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["contact_id"] ?? "").trim();
        if (!id) return { ok: false, error: "contact_id required" };
        const partial: Record<string, unknown> = {};
        if (typeof args["name"] === "string") partial["name"] = args["name"];
        if (typeof args["email"] === "string") partial["email"] = args["email"];
        if (args["is_customer"] === true) partial["IsCustomer"] = true;
        if (args["is_supplier"] === true) partial["IsSupplier"] = true;
        if (typeof args["tax_number"] === "string") partial["TaxNumber"] = args["tax_number"];
        if (Array.isArray(args["phones"])) partial["Phones"] = args["phones"];
        if (Array.isArray(args["addresses"])) partial["Addresses"] = args["addresses"];
        if (Object.keys(partial).length === 0) {
          return { ok: false, error: "provide at least one field to update" };
        }
        const body = sanitizeContactUpdate(id, partial);
        return asToolResult(
          await xeroFetch("/Contacts", {
            method: "POST",
            body: { Contacts: [body] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  const statusTool = (
    name: string,
    description: string,
    idParam: string,
    idLabel: string,
    pathPrefix: string,
    bodyKey: string,
    idKey: string,
    statuses: string[]
  ) => {
    registry.register(
      defineTool({
        name,
        description,
        parameters: {
          type: "object",
          properties: {
            ...COMMON,
            ...idArg(idParam, idLabel),
            status: { type: "string", description: statuses.join(" | ") },
          },
          required: [idParam, "status"],
          additionalProperties: false,
        },
        requiresApproval: true,
        handler: async (args): Promise<ToolResult> => {
          const id = String(args[idParam] ?? "").trim();
          const status = String(args["status"] ?? "").trim().toUpperCase();
          if (!id || !status) return { ok: false, error: `${idParam} and status required` };
          if (!statuses.includes(status)) {
            return { ok: false, error: `status must be one of: ${statuses.join(", ")}` };
          }
          const entity: Record<string, unknown> = { [idKey]: id, Status: status };
          return asToolResult(
            await xeroFetch(`${pathPrefix}/${encodeURIComponent(id)}`, {
              method: "POST",
              body: { [bodyKey]: [entity] },
              accountHint: xeroHint(args),
              tenantId: xeroTenant(args),
            })
          );
        },
      })
    );
  };

  statusTool(
    "xero_set_quote_status",
    "WHAT: Change quote status only (DRAFT, SENT, DECLINED, ACCEPTED, INVOICED).\nWHEN: Accept quote or mark invoiced.",
    "quote_id",
    "QuoteID GUID.",
    "/Quotes",
    "Quotes",
    "QuoteID",
    ["DRAFT", "SENT", "DECLINED", "ACCEPTED", "INVOICED"]
  );

  statusTool(
    "xero_set_purchase_order_status",
    "WHAT: Change PO status (DRAFT, SUBMITTED, AUTHORISED, BILLED, DELETED).\nWHEN: Authorise PO or mark billed.",
    "purchase_order_id",
    "PurchaseOrderID GUID.",
    "/PurchaseOrders",
    "PurchaseOrders",
    "PurchaseOrderID",
    ["DRAFT", "SUBMITTED", "AUTHORISED", "BILLED", "DELETED"]
  );

  statusTool(
    "xero_set_credit_note_status",
    "WHAT: Change credit note status (DRAFT, SUBMITTED, AUTHORISED, VOIDED).\nWHEN: Authorise or void a credit note.",
    "credit_note_id",
    "CreditNoteID GUID.",
    "/CreditNotes",
    "CreditNotes",
    "CreditNoteID",
    ["DRAFT", "SUBMITTED", "AUTHORISED", "VOIDED"]
  );

  registry.register(
    defineTool({
      name: "xero_update_quote",
      description:
        "WHAT: Update quote reference, dates, or line items (not status-only).\n" +
        "WHEN: Amend draft quote. For status use xero_set_quote_status.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("quote_id", "QuoteID GUID."),
          reference: { type: "string" },
          title: { type: "string" },
          expiry_date: { type: "string", description: "YYYY-MM-DD" },
          line_items: lineItemsProp("Replacement lines — TaxType required per line."),
        },
        required: ["quote_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["quote_id"] ?? "").trim();
        if (!id) return { ok: false, error: "quote_id required" };
        const partial: Record<string, unknown> = {};
        if (typeof args["reference"] === "string") partial["Reference"] = args["reference"].trim();
        if (typeof args["title"] === "string") partial["Title"] = args["title"].trim();
        if (typeof args["expiry_date"] === "string") partial["ExpiryDate"] = args["expiry_date"].trim();
        if (Array.isArray(args["line_items"])) partial["LineItems"] = args["line_items"];
        if (Object.keys(partial).length === 0) {
          return { ok: false, error: "provide reference, title, expiry_date, or line_items" };
        }
        const body = sanitizeQuoteUpdate(id, partial);
        return asToolResult(
          await xeroFetch(`/Quotes/${encodeURIComponent(id)}`, {
            method: "POST",
            body: { Quotes: [body] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_purchase_order",
      description: "WHAT: Update PO reference, delivery date, or line items.\nWHEN: Amend draft PO.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("purchase_order_id", "PurchaseOrderID GUID."),
          reference: { type: "string" },
          delivery_date: { type: "string", description: "YYYY-MM-DD" },
          line_items: lineItemsProp("Replacement line items."),
        },
        required: ["purchase_order_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["purchase_order_id"] ?? "").trim();
        if (!id) return { ok: false, error: "purchase_order_id required" };
        const partial: Record<string, unknown> = {};
        if (typeof args["reference"] === "string") partial["Reference"] = args["reference"].trim();
        if (typeof args["delivery_date"] === "string") partial["DeliveryDate"] = args["delivery_date"].trim();
        if (Array.isArray(args["line_items"])) partial["LineItems"] = args["line_items"];
        if (Object.keys(partial).length === 0) {
          return { ok: false, error: "provide reference, delivery_date, or line_items" };
        }
        const body = sanitizePurchaseOrderUpdate(id, partial);
        return asToolResult(
          await xeroFetch(`/PurchaseOrders/${encodeURIComponent(id)}`, {
            method: "POST",
            body: { PurchaseOrders: [body] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_credit_note",
      description: "WHAT: Update credit note reference or line items.\nWHEN: Amend draft credit note.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("credit_note_id", "CreditNoteID GUID."),
          reference: { type: "string" },
          line_items: lineItemsProp("Replacement line items."),
        },
        required: ["credit_note_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["credit_note_id"] ?? "").trim();
        if (!id) return { ok: false, error: "credit_note_id required" };
        const partial: Record<string, unknown> = {};
        if (typeof args["reference"] === "string") partial["Reference"] = args["reference"].trim();
        if (Array.isArray(args["line_items"])) partial["LineItems"] = args["line_items"];
        if (Object.keys(partial).length === 0) {
          return { ok: false, error: "provide reference or line_items" };
        }
        const body = sanitizeCreditNoteUpdate(id, partial);
        return asToolResult(
          await xeroFetch(`/CreditNotes/${encodeURIComponent(id)}`, {
            method: "POST",
            body: { CreditNotes: [body] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  const allocationTool = (
    name: string,
    description: string,
    idParam: string,
    idLabel: string,
    pathSegment: string,
    bodyKey: string
  ) => {
    registry.register(
      defineTool({
        name,
        description,
        parameters: {
          type: "object",
          properties: {
            ...COMMON,
            ...idArg(idParam, idLabel),
            invoice_id: { type: "string", description: "Invoice/bill to apply credit/cash to." },
            amount: { type: "number", description: "Amount to allocate (defaults to invoice amount due)." },
          },
          required: [idParam, "invoice_id"],
          additionalProperties: false,
        },
        requiresApproval: true,
        handler: async (args): Promise<ToolResult> => {
          const sourceId = String(args[idParam] ?? "").trim();
          const invoiceId = String(args["invoice_id"] ?? "").trim();
          if (!sourceId || !invoiceId) return { ok: false, error: `${idParam} and invoice_id required` };
          let amount = Number(args["amount"]);
          if (!Number.isFinite(amount) || amount <= 0) {
            const inv = await xeroFetchEntity(`/Invoices/${encodeURIComponent(invoiceId)}`, "Invoices", {
              accountHint: xeroHint(args),
              tenantId: xeroTenant(args),
            });
            if (!inv.ok) return inv;
            const due = Number(inv.entity["AmountDue"]);
            if (!Number.isFinite(due) || due <= 0) {
              return { ok: false, error: "amount required — invoice has no AmountDue" };
            }
            amount = due;
          }
          return asToolResult(
            await xeroFetch(`/${pathSegment}/${encodeURIComponent(sourceId)}/Allocations`, {
              method: "PUT",
              body: {
                [bodyKey]: [{ Invoice: { InvoiceID: invoiceId }, Amount: amount }],
              },
              accountHint: xeroHint(args),
              tenantId: xeroTenant(args),
            })
          );
        },
      })
    );
  };

  registry.register(
    defineTool({
      name: "xero_allocate_credit_note",
      description: "WHAT: Apply a credit note to an invoice or bill.\nWHEN: Customer credit reduces amount owed.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("credit_note_id", "CreditNoteID GUID."),
          invoice_id: { type: "string" },
          amount: { type: "number" },
        },
        required: ["credit_note_id", "invoice_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const creditNoteId = String(args["credit_note_id"] ?? "").trim();
        const invoiceId = String(args["invoice_id"] ?? "").trim();
        if (!creditNoteId || !invoiceId) return { ok: false, error: "credit_note_id and invoice_id required" };
        const amount = Number(args["amount"]);
        const allocation: Record<string, unknown> = { Invoice: { InvoiceID: invoiceId } };
        if (Number.isFinite(amount) && amount > 0) allocation["Amount"] = amount;
        return asToolResult(
          await xeroFetch(`/CreditNotes/${encodeURIComponent(creditNoteId)}/Allocations`, {
            method: "PUT",
            body: { Allocations: [allocation] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  allocationTool(
    "xero_allocate_overpayment",
    "WHAT: Apply customer overpayment to an invoice.\nWHEN: Allocate unapplied cash on account.",
    "overpayment_id",
    "OverpaymentID GUID.",
    "Overpayments",
    "Allocations"
  );

  allocationTool(
    "xero_allocate_prepayment",
    "WHAT: Apply supplier prepayment to a bill.\nWHEN: Allocate unapplied supplier credit.",
    "prepayment_id",
    "PrepaymentID GUID.",
    "Prepayments",
    "Allocations"
  );

  registry.register(
    defineTool({
      name: "xero_get_payment",
      description: "WHAT: Fetch one payment by PaymentID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("payment_id", "PaymentID GUID.") },
        required: ["payment_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["payment_id"] ?? "").trim();
        if (!id) return { ok: false, error: "payment_id required" };
        return asToolResult(
          await xeroFetch(`/Payments/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_delete_payment",
      description: "WHAT: Delete (void) a payment.\nWHEN: Undo mistaken payment recording.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("payment_id", "PaymentID GUID.") },
        required: ["payment_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["payment_id"] ?? "").trim();
        if (!id) return { ok: false, error: "payment_id required" };
        return asToolResult(
          await xeroFetch(`/Payments/${encodeURIComponent(id)}`, {
            method: "DELETE",
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_item",
      description: "WHAT: Fetch inventory/service item by ItemID or Code.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          item_id: { type: "string", description: "ItemID GUID." },
          code: { type: "string", description: "Item code (alternative to item_id)." },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["item_id"] ?? "").trim();
        const code = String(args["code"] ?? "").trim();
        if (id) {
          return asToolResult(
            await xeroFetch(`/Items/${encodeURIComponent(id)}`, {
              accountHint: xeroHint(args),
              tenantId: xeroTenant(args),
            })
          );
        }
        if (code) {
          const params = new URLSearchParams();
          params.set("where", `Code=="${code.replace(/"/g, '\\"')}"`);
          return asToolResult(
            await xeroFetch(xeroPathWithQuery("/Items", params), {
              accountHint: xeroHint(args),
              tenantId: xeroTenant(args),
            })
          );
        }
        return { ok: false, error: "item_id or code required" };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_item",
      description: "WHAT: Create inventory or service catalog item.\nWHEN: Reusable products on invoices.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          code: { type: "string", description: "Unique item code." },
          name: { type: "string" },
          description: { type: "string" },
          sales_unit_price: { type: "number" },
          sales_account_code: { type: "string" },
          purchase_unit_price: { type: "number" },
          purchase_account_code: { type: "string" },
        },
        required: ["code", "name"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const code = String(args["code"] ?? "").trim();
        const name = String(args["name"] ?? "").trim();
        if (!code || !name) return { ok: false, error: "code and name required" };
        const item: Record<string, unknown> = { Code: code, Name: name };
        if (typeof args["description"] === "string" && args["description"].trim()) {
          item["Description"] = args["description"].trim();
        }
        const salesPrice = Number(args["sales_unit_price"]);
        const salesAcct = typeof args["sales_account_code"] === "string" ? args["sales_account_code"].trim() : "";
        if (Number.isFinite(salesPrice) || salesAcct) {
          item["SalesDetails"] = {
            ...(Number.isFinite(salesPrice) ? { UnitPrice: salesPrice } : {}),
            ...(salesAcct ? { AccountCode: salesAcct } : {}),
          };
        }
        const purchasePrice = Number(args["purchase_unit_price"]);
        const purchaseAcct =
          typeof args["purchase_account_code"] === "string" ? args["purchase_account_code"].trim() : "";
        if (Number.isFinite(purchasePrice) || purchaseAcct) {
          item["PurchaseDetails"] = {
            ...(Number.isFinite(purchasePrice) ? { UnitPrice: purchasePrice } : {}),
            ...(purchaseAcct ? { AccountCode: purchaseAcct } : {}),
          };
        }
        return asToolResult(
          await xeroFetch("/Items", {
            method: "PUT",
            body: { Items: [item] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_update_item",
      description: "WHAT: Update item name, description, or pricing.\nWHEN: Catalog maintenance.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          item_id: { type: "string", description: "ItemID GUID." },
          code: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          sales_unit_price: { type: "number" },
          sales_account_code: { type: "string" },
          purchase_unit_price: { type: "number" },
          purchase_account_code: { type: "string" },
        },
        required: ["item_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["item_id"] ?? "").trim();
        if (!id) return { ok: false, error: "item_id required" };
        const item: Record<string, unknown> = { ItemID: id };
        if (typeof args["code"] === "string" && args["code"].trim()) item["Code"] = args["code"].trim();
        if (typeof args["name"] === "string" && args["name"].trim()) item["Name"] = args["name"].trim();
        if (typeof args["description"] === "string") item["Description"] = args["description"].trim();
        const salesPrice = Number(args["sales_unit_price"]);
        const salesAcct = typeof args["sales_account_code"] === "string" ? args["sales_account_code"].trim() : "";
        if (Number.isFinite(salesPrice) || salesAcct) {
          item["SalesDetails"] = {
            ...(Number.isFinite(salesPrice) ? { UnitPrice: salesPrice } : {}),
            ...(salesAcct ? { AccountCode: salesAcct } : {}),
          };
        }
        const purchasePrice = Number(args["purchase_unit_price"]);
        const purchaseAcct =
          typeof args["purchase_account_code"] === "string" ? args["purchase_account_code"].trim() : "";
        if (Number.isFinite(purchasePrice) || purchaseAcct) {
          item["PurchaseDetails"] = {
            ...(Number.isFinite(purchasePrice) ? { UnitPrice: purchasePrice } : {}),
            ...(purchaseAcct ? { AccountCode: purchaseAcct } : {}),
          };
        }
        return asToolResult(
          await xeroFetch("/Items", {
            method: "POST",
            body: { Items: [item] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_report_tax_summary",
      description:
        "WHAT: Tax / GST summary report for a period (BAS prep, tax liability).\n" +
        "WHEN: User asks about GST, VAT, or tax owed — pass fromDate and toDate.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          fromDate: { type: "string", description: "YYYY-MM-DD" },
          toDate: { type: "string", description: "YYYY-MM-DD" },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroReportParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/Reports/TaxSummary", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_quote_to_invoice",
      description:
        "WHAT: Create a sales invoice from an accepted/draft quote and mark quote INVOICED.\n" +
        "WHEN: User says convert quote to invoice.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("quote_id", "QuoteID GUID."),
          authorise: {
            type: "boolean",
            description: "If true, authorise the new invoice after create (default false).",
          },
        },
        required: ["quote_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const quoteId = String(args["quote_id"] ?? "").trim();
        if (!quoteId) return { ok: false, error: "quote_id required" };
        const opts = { accountHint: xeroHint(args), tenantId: xeroTenant(args) };
        const q = await xeroFetchEntity(`/Quotes/${encodeURIComponent(quoteId)}`, "Quotes", opts);
        if (!q.ok) return q;
        const quote = q.entity;
        const contactId = contactIdFromEntity(quote);
        if (!contactId) return { ok: false, error: "quote has no ContactID" };
        const lines = lineItemsFromEntity(quote);
        if (lines.length === 0) return { ok: false, error: "quote has no line items" };
        const norm = normalizeXeroLineItems(lines, { requireTaxType: true });
        if (!norm.ok) return { ok: false, error: norm.error };
        const invoice: Record<string, unknown> = {
          Type: "ACCREC",
          Contact: { ContactID: contactId },
          LineItems: norm.lineItems,
          Status: "DRAFT",
          LineAmountTypes: quote["LineAmountTypes"] ?? "Exclusive",
          Reference: quote["Reference"] ?? quote["QuoteNumber"],
          Date: todayXeroDate(),
        };
        const invR = await xeroFetch("/Invoices", {
          method: "PUT",
          body: { Invoices: [invoice] },
          ...opts,
        });
        if (!invR.ok) return invR;
        const created = xeroFirstEntity(invR.data, "Invoices");
        const invoiceId = created?.["InvoiceID"];
        await xeroFetch(`/Quotes/${encodeURIComponent(quoteId)}`, {
          method: "POST",
          body: { Quotes: [{ QuoteID: quoteId, Status: "INVOICED" }] },
          ...opts,
        });
        if (args["authorise"] === true && typeof invoiceId === "string") {
          await xeroFetch(`/Invoices/${encodeURIComponent(invoiceId)}`, {
            method: "POST",
            body: { Invoices: [{ InvoiceID: invoiceId, Status: "AUTHORISED" }] },
            ...opts,
          });
        }
        return {
          ok: true,
          output: jsonOutput({
            quote_id: quoteId,
            invoice: created,
            quote_status: "INVOICED",
            authorised: args["authorise"] === true,
          }),
        };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_po_to_bill",
      description:
        "WHAT: Create a supplier bill (ACCPAY) from a purchase order.\n" +
        "WHEN: User received goods and wants to bill the PO.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("purchase_order_id", "PurchaseOrderID GUID."),
          mark_po_billed: {
            type: "boolean",
            description: "If true, set PO status BILLED after bill create (default true).",
          },
        },
        required: ["purchase_order_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const poId = String(args["purchase_order_id"] ?? "").trim();
        if (!poId) return { ok: false, error: "purchase_order_id required" };
        const opts = { accountHint: xeroHint(args), tenantId: xeroTenant(args) };
        const poR = await xeroFetchEntity(`/PurchaseOrders/${encodeURIComponent(poId)}`, "PurchaseOrders", opts);
        if (!poR.ok) return poR;
        const po = poR.entity;
        const contactId = contactIdFromEntity(po);
        if (!contactId) return { ok: false, error: "PO has no ContactID" };
        const lines = lineItemsFromEntity(po);
        if (lines.length === 0) return { ok: false, error: "PO has no line items" };
        const norm = normalizeXeroLineItems(lines);
        if (!norm.ok) return { ok: false, error: norm.error };
        const bill: Record<string, unknown> = {
          Type: "ACCPAY",
          Contact: { ContactID: contactId },
          LineItems: norm.lineItems,
          Status: "DRAFT",
          LineAmountTypes: po["LineAmountTypes"] ?? "Exclusive",
          Reference: po["Reference"] ?? po["PurchaseOrderNumber"],
          Date: todayXeroDate(),
        };
        const billR = await xeroFetch("/Invoices", {
          method: "PUT",
          body: { Invoices: [bill] },
          ...opts,
        });
        if (!billR.ok) return billR;
        const created = xeroFirstEntity(billR.data, "Invoices");
        const markBilled = args["mark_po_billed"] !== false;
        if (markBilled) {
          await xeroFetch(`/PurchaseOrders/${encodeURIComponent(poId)}`, {
            method: "POST",
            body: { PurchaseOrders: [{ PurchaseOrderID: poId, Status: "BILLED" }] },
            ...opts,
          });
        }
        return {
          ok: true,
          output: jsonOutput({
            purchase_order_id: poId,
            bill: created,
            po_status: markBilled ? "BILLED" : undefined,
          }),
        };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_authorise_and_email_invoice",
      description:
        "WHAT: Authorise a sales invoice and email it to the contact.\n" +
        "WHEN: User says send/approve invoice to customer.",
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
        const authR = await xeroFetch(`/Invoices/${encodeURIComponent(id)}`, {
          method: "POST",
          body: { Invoices: [{ InvoiceID: id, Status: "AUTHORISED" }] },
          ...opts,
        });
        if (!authR.ok) return authR;
        const emailR = await xeroFetch(`/Invoices/${encodeURIComponent(id)}/Email`, {
          method: "POST",
          body: {},
          ...opts,
        });
        if (!emailR.ok) return emailR;
        return {
          ok: true,
          output: jsonOutput({ invoice_id: id, status: "AUTHORISED", emailed: true }),
        };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_record_invoice_payment",
      description:
        "WHAT: Record full (or partial) payment against an invoice/bill.\n" +
        "WHEN: Customer paid or you paid supplier — auto-uses AmountDue if amount omitted.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("invoice_id", "InvoiceID GUID."),
          bank_account_id: { type: "string", description: "Bank AccountID — use xero_list_bank_accounts." },
          amount: { type: "number", description: "Optional; defaults to AmountDue." },
          date: { type: "string", description: "YYYY-MM-DD" },
          reference: { type: "string" },
        },
        required: ["invoice_id", "bank_account_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const invoiceId = String(args["invoice_id"] ?? "").trim();
        const bankId = String(args["bank_account_id"] ?? "").trim();
        if (!invoiceId || !bankId) return { ok: false, error: "invoice_id and bank_account_id required" };
        const opts = { accountHint: xeroHint(args), tenantId: xeroTenant(args) };
        let amount = Number(args["amount"]);
        if (!Number.isFinite(amount) || amount <= 0) {
          const inv = await xeroFetchEntity(`/Invoices/${encodeURIComponent(invoiceId)}`, "Invoices", opts);
          if (!inv.ok) return inv;
          amount = Number(inv.entity["AmountDue"]);
          if (!Number.isFinite(amount) || amount <= 0) {
            return { ok: false, error: "invoice has no AmountDue — pass amount explicitly" };
          }
        }
        const payment: Record<string, unknown> = {
          Invoice: { InvoiceID: invoiceId },
          Account: { AccountID: bankId },
          Amount: amount,
        };
        if (typeof args["date"] === "string" && args["date"].trim()) payment["Date"] = args["date"].trim();
        if (typeof args["reference"] === "string" && args["reference"].trim()) {
          payment["Reference"] = args["reference"].trim();
        }
        return asToolResult(
          await xeroFetch("/Payments", {
            method: "PUT",
            body: { Payments: [payment] },
            ...opts,
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_delete_attachment",
      description: "WHAT: Delete a file attachment from an invoice, bill, PO, quote, etc.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          parent_type: {
            type: "string",
            enum: ["Invoices", "CreditNotes", "PurchaseOrders", "Quotes", "BankTransactions", "Contacts", "Accounts", "ManualJournals"],
          },
          parent_id: { type: "string" },
          file_name: { type: "string", description: "Attachment file name from xero_list_attachments." },
        },
        required: ["parent_type", "parent_id", "file_name"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const parentType = String(args["parent_type"] ?? "").trim();
        const parentId = String(args["parent_id"] ?? "").trim();
        const fileName = String(args["file_name"] ?? "").trim();
        if (!isXeroAttachmentParent(parentType)) {
          return { ok: false, error: "invalid parent_type" };
        }
        if (!parentId || !fileName) return { ok: false, error: "parent_id and file_name required" };
        return asToolResult(
          await xeroFetch(
            `/${parentType}/${encodeURIComponent(parentId)}/Attachments/${encodeURIComponent(fileName)}`,
            {
              method: "DELETE",
              accountHint: xeroHint(args),
              tenantId: xeroTenant(args),
            }
          )
        );
      },
    })
  );
}
