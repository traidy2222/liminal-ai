/**
 * Xero Phase 2 — attachments, batch payments, repeating invoices, linked txns,
 * overpayments/prepayments, bank transfers, quote/PO create.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { PropertySchema, ToolRegistry, ToolResult } from "@liminal/core";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  asToolResult,
  isXeroAttachmentParent,
  jsonOutput,
  xeroCommonProps,
  xeroFetch,
  xeroFetchBinary,
  xeroHint,
  xeroPageParams,
  xeroPathWithQuery,
  xeroTenant,
  xeroUploadAttachment,
  XERO_ATTACHMENT_PARENTS,
} from "./xero_api.js";
import { normalizeXeroLineItems, sanitizeQuoteCreate, todayXeroDate } from "./xero_validation.js";

const COMMON = xeroCommonProps();

const PARENT_TYPE_PROP: PropertySchema = {
  type: "string",
  enum: [...XERO_ATTACHMENT_PARENTS],
  description: "Xero parent resource type for attachments.",
};

function idArg(name: string, label: string): Record<string, PropertySchema> {
  return { [name]: { type: "string", description: label } };
}

async function readAttachmentBytes(args: Record<string, unknown>): Promise<
  | { ok: true; bytes: Buffer; fileName: string; contentType?: string }
  | { ok: false; error: string }
> {
  const fileNameArg = typeof args["file_name"] === "string" ? args["file_name"].trim() : "";
  const b64 = typeof args["content_base64"] === "string" ? args["content_base64"].trim() : "";
  const filePath = typeof args["file_path"] === "string" ? args["file_path"].trim() : "";

  if (b64) {
    try {
      const bytes = Buffer.from(b64, "base64");
      if (bytes.length === 0) return { ok: false, error: "content_base64 decoded to empty buffer" };
      return { ok: true, bytes, fileName: fileNameArg || "attachment.bin" };
    } catch {
      return { ok: false, error: "invalid content_base64" };
    }
  }

  if (filePath) {
    const ws = resolveWorkspaceRoot();
    const abs = resolve(ws, filePath);
    if (!abs.startsWith(resolve(ws))) {
      return { ok: false, error: "file_path must stay inside workspace" };
    }
    try {
      const bytes = await readFile(abs);
      return {
        ok: true,
        bytes,
        fileName: fileNameArg || basename(abs),
        contentType: typeof args["mime_type"] === "string" ? args["mime_type"] : undefined,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return { ok: false, error: "provide file_path or content_base64" };
}

export function registerXeroRestPhase2Tools(registry: ToolRegistry): void {
  registry.register(
    defineTool({
      name: "xero_list_attachments",
      description:
        "WHAT: List file attachments on an invoice, bill, credit note, PO, quote, etc.\n" +
        "WHEN: User asks what files are attached to a Xero document.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          parent_type: PARENT_TYPE_PROP,
          parent_id: { type: "string", description: "Parent resource GUID." },
        },
        required: ["parent_type", "parent_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const parentType = String(args["parent_type"] ?? "");
        const parentId = String(args["parent_id"] ?? "").trim();
        if (!isXeroAttachmentParent(parentType) || !parentId) {
          return { ok: false, error: "valid parent_type and parent_id required" };
        }
        return asToolResult(
          await xeroFetch(`/${parentType}/${encodeURIComponent(parentId)}/Attachments`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_attachment",
      description:
        "WHAT: Download an attachment by file name from a Xero document.\n" +
        "WHEN: User needs the PDF/image from an invoice or bill.\n" +
        "Saves to save_path (workspace-relative) or returns base64 if under 4 MB.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          parent_type: PARENT_TYPE_PROP,
          parent_id: { type: "string" },
          file_name: { type: "string", description: "Attachment file name as shown in Xero." },
          save_path: { type: "string", description: "Optional workspace path to write file." },
        },
        required: ["parent_type", "parent_id", "file_name"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const parentType = String(args["parent_type"] ?? "");
        const parentId = String(args["parent_id"] ?? "").trim();
        const fileName = String(args["file_name"] ?? "").trim();
        if (!isXeroAttachmentParent(parentType) || !parentId || !fileName) {
          return { ok: false, error: "parent_type, parent_id, and file_name required" };
        }
        const r = await xeroFetchBinary(
          `/${parentType}/${encodeURIComponent(parentId)}/Attachments/${encodeURIComponent(fileName)}`,
          { accountHint: xeroHint(args), tenantId: xeroTenant(args) }
        );
        if (!r.ok) return r;

        const savePath = typeof args["save_path"] === "string" ? args["save_path"].trim() : "";
        if (savePath) {
          const ws = resolveWorkspaceRoot();
          const abs = resolve(ws, savePath);
          if (!abs.startsWith(resolve(ws))) {
            return { ok: false, error: "save_path must stay inside workspace" };
          }
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, r.data);
          return {
            ok: true,
            output: jsonOutput({
              saved: savePath,
              bytes: r.data.length,
              contentType: r.contentType,
            }),
          };
        }

        const maxInline = 4 * 1024 * 1024;
        if (r.data.length > maxInline) {
          return {
            ok: false,
            error: `attachment is ${r.data.length} bytes — pass save_path to write to workspace (max inline ${maxInline})`,
          };
        }
        return {
          ok: true,
          output: jsonOutput({
            file_name: fileName,
            contentType: r.contentType,
            content_base64: r.data.toString("base64"),
            bytes: r.data.length,
          }),
        };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_upload_attachment",
      description:
        "WHAT: Attach a file (PDF, image) to an invoice, bill, credit note, PO, or quote.\n" +
        "WHEN: User wants to upload a receipt or invoice PDF to Xero.\n" +
        "Provide file_path (workspace-relative) or content_base64.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          parent_type: PARENT_TYPE_PROP,
          parent_id: { type: "string" },
          file_name: { type: "string", description: "Target file name in Xero (defaults from file_path)." },
          file_path: { type: "string", description: "Workspace-relative path to upload." },
          content_base64: { type: "string", description: "Raw file bytes as base64." },
          mime_type: { type: "string", description: "Optional Content-Type (default application/octet-stream)." },
          include_online: {
            type: "boolean",
            description: "If true, customer can see attachment on online invoice.",
          },
        },
        required: ["parent_type", "parent_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const parentType = String(args["parent_type"] ?? "");
        const parentId = String(args["parent_id"] ?? "").trim();
        if (!isXeroAttachmentParent(parentType) || !parentId) {
          return { ok: false, error: "valid parent_type and parent_id required" };
        }
        const file = await readAttachmentBytes(args);
        if (!file.ok) return file;
        return asToolResult(
          await xeroUploadAttachment(parentType, parentId, file.fileName, file.bytes, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
            includeOnline: args["include_online"] === true,
            contentType: file.contentType,
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_batch_payments",
      description: "WHAT: List batch payments (pay multiple bills/invoices in one batch).",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/BatchPayments", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_batch_payment",
      description:
        "WHAT: Create a batch payment from one bank account to multiple invoices/bills.\n" +
        "WHEN: Paying several suppliers or recording a payment run.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          bank_account_id: { type: "string", description: "Bank AccountID." },
          reference: { type: "string" },
          payments: {
            type: "array",
            description: "Array of { invoice_id, amount, reference? }.",
            items: { type: "object" },
          },
          date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["bank_account_id", "payments"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const bankId = String(args["bank_account_id"] ?? "").trim();
        const rawPayments = args["payments"];
        if (!bankId || !Array.isArray(rawPayments) || rawPayments.length === 0) {
          return { ok: false, error: "bank_account_id and non-empty payments required" };
        }
        const payments: Record<string, unknown>[] = [];
        for (const p of rawPayments) {
          const row = p as Record<string, unknown>;
          const invoiceId = String(row["invoice_id"] ?? "").trim();
          const amount = Number(row["amount"]);
          if (!invoiceId || !Number.isFinite(amount)) {
            return { ok: false, error: "each payment needs invoice_id and numeric amount" };
          }
          const payment: Record<string, unknown> = {
            Invoice: { InvoiceID: invoiceId },
            Amount: amount,
          };
          if (typeof row["reference"] === "string" && row["reference"].trim()) {
            payment["Reference"] = row["reference"].trim();
          }
          payments.push(payment);
        }

        const batch: Record<string, unknown> = {
          Account: { AccountID: bankId },
          Payments: payments,
        };
        if (typeof args["reference"] === "string" && args["reference"].trim()) {
          batch["Reference"] = args["reference"].trim();
        }
        if (typeof args["date"] === "string" && args["date"].trim()) {
          batch["Date"] = args["date"].trim();
        }
        return asToolResult(
          await xeroFetch("/BatchPayments", {
            method: "PUT",
            body: { BatchPayments: [batch] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_repeating_invoices",
      description: "WHAT: List repeating (recurring) invoice templates.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/RepeatingInvoices", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_repeating_invoice",
      description: "WHAT: Fetch one repeating invoice template by RepeatingInvoiceID.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("repeating_invoice_id", "RepeatingInvoiceID GUID."),
        },
        required: ["repeating_invoice_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["repeating_invoice_id"] ?? "").trim();
        if (!id) return { ok: false, error: "repeating_invoice_id required" };
        return asToolResult(
          await xeroFetch(`/RepeatingInvoices/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_repeating_invoice",
      description:
        "WHAT: Create a repeating invoice template (subscription/recurring billing).\n" +
        "Pass a full repeating_invoice object per Xero API (Type, Contact, Schedule, LineItems).",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          repeating_invoice: { type: "object", description: "RepeatingInvoice payload." },
        },
        required: ["repeating_invoice"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const payload = args["repeating_invoice"];
        if (!payload || typeof payload !== "object") {
          return { ok: false, error: "repeating_invoice object required" };
        }
        return asToolResult(
          await xeroFetch("/RepeatingInvoices", {
            method: "PUT",
            body: { RepeatingInvoices: [payload] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_linked_transactions",
      description:
        "WHAT: List linked transactions (reconcile bank lines to invoices/bills).\n" +
        "WHEN: Bank reconciliation or matching spend to documents.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/LinkedTransactions", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_linked_transaction",
      description:
        "WHAT: Link a bank transaction line to an invoice/bill (reconciliation).\n" +
        "Pass linked_transaction object per Xero API (SourceTransactionID, TargetTransactionID, etc.).",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          linked_transaction: { type: "object" },
        },
        required: ["linked_transaction"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const payload = args["linked_transaction"];
        if (!payload || typeof payload !== "object") {
          return { ok: false, error: "linked_transaction object required" };
        }
        return asToolResult(
          await xeroFetch("/LinkedTransactions", {
            method: "PUT",
            body: { LinkedTransactions: [payload] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_overpayments",
      description: "WHAT: List customer/supplier overpayments.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/Overpayments", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_overpayment",
      description: "WHAT: Fetch one overpayment by OverpaymentID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("overpayment_id", "OverpaymentID GUID.") },
        required: ["overpayment_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["overpayment_id"] ?? "").trim();
        if (!id) return { ok: false, error: "overpayment_id required" };
        return asToolResult(
          await xeroFetch(`/Overpayments/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_prepayments",
      description: "WHAT: List customer/supplier prepayments.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/Prepayments", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_prepayment",
      description: "WHAT: Fetch one prepayment by PrepaymentID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("prepayment_id", "PrepaymentID GUID.") },
        required: ["prepayment_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["prepayment_id"] ?? "").trim();
        if (!id) return { ok: false, error: "prepayment_id required" };
        return asToolResult(
          await xeroFetch(`/Prepayments/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_bank_transfers",
      description: "WHAT: List transfers between bank accounts.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/BankTransfers", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_bank_transfer",
      description: "WHAT: Transfer money between two bank accounts in Xero.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          from_bank_account_id: { type: "string" },
          to_bank_account_id: { type: "string" },
          amount: { type: "number" },
          reference: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["from_bank_account_id", "to_bank_account_id", "amount"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const fromId = String(args["from_bank_account_id"] ?? "").trim();
        const toId = String(args["to_bank_account_id"] ?? "").trim();
        const amount = Number(args["amount"]);
        if (!fromId || !toId || !Number.isFinite(amount)) {
          return { ok: false, error: "from_bank_account_id, to_bank_account_id, and amount required" };
        }
        const transfer: Record<string, unknown> = {
          FromBankAccount: { AccountID: fromId },
          ToBankAccount: { AccountID: toId },
          Amount: amount,
        };
        if (typeof args["reference"] === "string" && args["reference"].trim()) {
          transfer["Reference"] = args["reference"].trim();
        }
        if (typeof args["date"] === "string" && args["date"].trim()) {
          transfer["Date"] = args["date"].trim();
        }
        return asToolResult(
          await xeroFetch("/BankTransfers", {
            method: "PUT",
            body: { BankTransfers: [transfer] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_quote",
      description: "WHAT: Fetch one sales quote by QuoteID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("quote_id", "QuoteID GUID.") },
        required: ["quote_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["quote_id"] ?? "").trim();
        if (!id) return { ok: false, error: "quote_id required" };
        return asToolResult(
          await xeroFetch(`/Quotes/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_quote",
      description:
        "WHAT: Create a sales quote (draft).\n" +
        "WHEN: Each line needs Description, UnitAmount, AccountCode, and TaxType (call xero_list_tax_rates first — quotes do not inherit tax from accounts).",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          contact_id: { type: "string" },
          line_items: {
            type: "array",
            description: "Lines: Description, UnitAmount, AccountCode, TaxType (required per line).",
            items: { type: "object" },
          },
          reference: { type: "string" },
          title: { type: "string" },
          date: { type: "string", description: "Quote date YYYY-MM-DD (defaults to today)." },
          expiry_date: { type: "string", description: "YYYY-MM-DD" },
          default_tax_type: {
            type: "string",
            description: "Applied to lines missing TaxType (e.g. OUTPUT, NONE — from xero_list_tax_rates).",
          },
        },
        required: ["contact_id", "line_items"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const contactId = String(args["contact_id"] ?? "").trim();
        const lineItems = args["line_items"];
        if (!contactId || !Array.isArray(lineItems) || lineItems.length === 0) {
          return { ok: false, error: "contact_id and line_items required" };
        }
        const defaultTax =
          typeof args["default_tax_type"] === "string" && args["default_tax_type"].trim()
            ? args["default_tax_type"].trim()
            : undefined;
        const norm = normalizeXeroLineItems(lineItems, {
          defaultTaxType: defaultTax,
          requireTaxType: !defaultTax,
        });
        if (!norm.ok) return { ok: false, error: norm.error };

        const quote = sanitizeQuoteCreate({
          Contact: { ContactID: contactId },
          LineItems: norm.lineItems,
          Date: typeof args["date"] === "string" && args["date"].trim() ? args["date"].trim() : todayXeroDate(),
          Reference: typeof args["reference"] === "string" ? args["reference"].trim() : undefined,
          Title: typeof args["title"] === "string" ? args["title"].trim() : undefined,
          ExpiryDate: typeof args["expiry_date"] === "string" ? args["expiry_date"].trim() : undefined,
        });
        return asToolResult(
          await xeroFetch("/Quotes", {
            method: "PUT",
            body: { Quotes: [quote] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_purchase_order",
      description: "WHAT: Fetch one purchase order by PurchaseOrderID.",
      parameters: {
        type: "object",
        properties: { ...COMMON, ...idArg("purchase_order_id", "PurchaseOrderID GUID.") },
        required: ["purchase_order_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["purchase_order_id"] ?? "").trim();
        if (!id) return { ok: false, error: "purchase_order_id required" };
        return asToolResult(
          await xeroFetch(`/PurchaseOrders/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_purchase_order",
      description: "WHAT: Create a purchase order (draft).",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          contact_id: { type: "string", description: "Supplier ContactID." },
          line_items: { type: "array", items: { type: "object" } },
          reference: { type: "string" },
          delivery_date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["contact_id", "line_items"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const contactId = String(args["contact_id"] ?? "").trim();
        const lineItems = args["line_items"];
        if (!contactId || !Array.isArray(lineItems) || lineItems.length === 0) {
          return { ok: false, error: "contact_id and line_items required" };
        }
        const norm = normalizeXeroLineItems(lineItems);
        if (!norm.ok) return { ok: false, error: norm.error };
        const po: Record<string, unknown> = {
          Contact: { ContactID: contactId },
          LineItems: norm.lineItems,
          Status: "DRAFT",
        };
        if (typeof args["reference"] === "string" && args["reference"].trim()) {
          po["Reference"] = args["reference"].trim();
        }
        if (typeof args["delivery_date"] === "string" && args["delivery_date"].trim()) {
          po["DeliveryDate"] = args["delivery_date"].trim();
        }
        return asToolResult(
          await xeroFetch("/PurchaseOrders", {
            method: "PUT",
            body: { PurchaseOrders: [po] },
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_branding_themes",
      description: "WHAT: List invoice branding themes (logo, colours).",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 300_000,
      handler: async (args): Promise<ToolResult> =>
        asToolResult(
          await xeroFetch("/BrandingThemes", { accountHint: xeroHint(args), tenantId: xeroTenant(args) })
        ),
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_currencies",
      description: "WHAT: List organisation currencies.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 300_000,
      handler: async (args): Promise<ToolResult> =>
        asToolResult(
          await xeroFetch("/Currencies", { accountHint: xeroHint(args), tenantId: xeroTenant(args) })
        ),
    })
  );
}
