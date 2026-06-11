/**
 * Core Xero Accounting API REST tools (invoices, contacts, organisations).
 */
import type { ToolRegistry, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { integrationNotConnectedError } from "../core/integration_oauth_start.js";
import {
  asToolResult,
  jsonOutput,
  resolveXeroAuth,
  xeroCommonProps,
  xeroFetch,
  xeroHint,
  xeroPageParams,
  xeroPathWithQuery,
  xeroTenant,
} from "./xero_api.js";
import { normalizeXeroLineItems } from "./xero_validation.js";

export { xeroRestEnabled } from "./xero_api.js";

const COMMON = xeroCommonProps();

export function registerXeroRestTools(registry: ToolRegistry): void {
  registry.register(
    defineTool({
      name: "xero_list_organisations",
      description:
        "WHAT: List Xero organisations (tenants) linked to the connected account.\n" +
        "WHEN: User asks which Xero org is active or needs tenant_id for another call.",
      parameters: {
        type: "object",
        properties: { account_hint: { type: "string", description: "Optional account email or id." } },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const auth = await resolveXeroAuth(xeroHint(args));
        if (!auth) return { ok: false, error: integrationNotConnectedError("xero") };
        const meta = auth.bundle.metadata as { tenants?: unknown[] } | undefined;
        return { ok: true, output: jsonOutput(meta?.tenants ?? []) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_invoices",
      description: "WHAT: List sales invoices and bills (ACCREC/ACCPAY) in Xero.",
      parameters: {
        type: "object",
        properties: { ...COMMON, status: { type: "string", description: "DRAFT, AUTHORISED, PAID, VOIDED, etc." } },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/Invoices", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_invoice",
      description: "WHAT: Fetch one invoice or bill by InvoiceID GUID.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          invoice_id: { type: "string", description: "Xero InvoiceID (GUID)." },
        },
        required: ["invoice_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["invoice_id"] ?? "").trim();
        if (!id) return { ok: false, error: "invoice_id required" };
        return asToolResult(
          await xeroFetch(`/Invoices/${encodeURIComponent(id)}`, {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_contacts",
      description: "WHAT: List contacts (customers/suppliers) in Xero.",
      parameters: { type: "object", properties: { ...COMMON }, additionalProperties: false },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = xeroPageParams(args);
        return asToolResult(
          await xeroFetch(xeroPathWithQuery("/Contacts", params), {
            accountHint: xeroHint(args),
            tenantId: xeroTenant(args),
          })
        );
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_create_invoice",
      description:
        "WHAT: Create a sales invoice (ACCREC) in Xero.\n" +
        "WHEN: User asks to bill a customer — requires write scopes.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          contact_id: { type: "string", description: "Xero ContactID for the customer." },
          line_items: {
            type: "array",
            description: "Line items with Description, Quantity, UnitAmount, AccountCode.",
            items: { type: "object" },
          },
          reference: { type: "string" },
          due_date: { type: "string", description: "YYYY-MM-DD" },
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
          Type: "ACCREC",
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
}
