/**
 * Xero Phase 3.5 — high-level composites (upsert, project billing, month-end, dedupe).
 */
import type { PropertySchema, ToolRegistry, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  asToolResult,
  jsonOutput,
  xeroCommonProps,
  xeroFetch,
  xeroHint,
  xeroPathWithQuery,
  xeroReportParams,
  xeroTenant,
} from "./xero_api.js";
import { XERO_PROJECTS_API } from "./xero_api_bases.js";
import {
  aggregateProjectTimeByTask,
  xeroEntityArray,
  xeroFirstEntity,
} from "./xero_helpers.js";
import { normalizeXeroLineItems, sanitizeContactUpdate, todayXeroDate } from "./xero_validation.js";

const COMMON = xeroCommonProps();
const PROJECTS_OPTS = { apiBase: XERO_PROJECTS_API as typeof XERO_PROJECTS_API };

function idArg(name: string, label: string): Record<string, PropertySchema> {
  return { [name]: { type: "string", description: label } };
}

async function findContactsByQuery(
  args: Record<string, unknown>,
  query: string
): Promise<Record<string, unknown>[]> {
  const escaped = query.replace(/"/g, '\\"');
  const params = new URLSearchParams();
  params.set("where", `Name.Contains("${escaped}") || EmailAddress.Contains("${escaped}")`);
  const r = await xeroFetch(xeroPathWithQuery("/Contacts", params), {
    accountHint: xeroHint(args),
    tenantId: xeroTenant(args),
  });
  if (!r.ok) return [];
  return xeroEntityArray(r.data, "Contacts");
}

export function registerXeroPhase35CompositeTools(registry: ToolRegistry): void {
  registry.register(
    defineTool({
      name: "xero_upsert_contact",
      description:
        "WHAT: Find contact by email or name; update if found, else create.\n" +
        "WHEN: Imports, CRM sync, before invoicing — avoids duplicate contacts.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          name: { type: "string", description: "Contact display name (required)." },
          email: { type: "string", description: "Primary match key when provided." },
          is_customer: { type: "boolean" },
          is_supplier: { type: "boolean" },
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
        const email = typeof args["email"] === "string" ? args["email"].trim() : "";
        const opts = { accountHint: xeroHint(args), tenantId: xeroTenant(args) };
        const searchQ = email || name;
        let matches = await findContactsByQuery(args, searchQ);
        if (email) {
          const emailLower = email.toLowerCase();
          const byEmail = matches.filter(
            (c) => String(c["EmailAddress"] ?? "").toLowerCase() === emailLower
          );
          if (byEmail.length > 0) matches = byEmail;
        }
        const exactName = matches.filter(
          (c) => String(c["Name"] ?? "").toLowerCase() === name.toLowerCase()
        );
        const existing = (email ? exactName : exactName.length ? exactName : matches)[0];

        if (existing?.["ContactID"]) {
          const contactId = String(existing["ContactID"]);
          const patch: Record<string, unknown> = { name, email };
          if (args["is_customer"] === true) patch["IsCustomer"] = true;
          if (args["is_supplier"] === true) patch["IsSupplier"] = true;
          if (typeof args["tax_number"] === "string" && args["tax_number"].trim()) {
            patch["TaxNumber"] = args["tax_number"].trim();
          }
          if (Array.isArray(args["phones"])) patch["Phones"] = args["phones"];
          if (Array.isArray(args["addresses"])) patch["Addresses"] = args["addresses"];
          const sanitized = sanitizeContactUpdate(contactId, patch);
          const r = await xeroFetch("/Contacts", {
            method: "POST",
            body: { Contacts: [sanitized] },
            ...opts,
          });
          if (!r.ok) return r;
          return {
            ok: true,
            output: jsonOutput({
              action: "updated",
              contact: xeroFirstEntity(r.data, "Contacts") ?? sanitized,
            }),
          };
        }

        const contact: Record<string, unknown> = { Name: name };
        if (email) contact["EmailAddress"] = email;
        if (args["is_customer"] === true) contact["IsCustomer"] = true;
        if (args["is_supplier"] === true) contact["IsSupplier"] = true;
        if (typeof args["tax_number"] === "string" && args["tax_number"].trim()) {
          contact["TaxNumber"] = args["tax_number"].trim();
        }
        if (Array.isArray(args["phones"])) contact["Phones"] = args["phones"];
        if (Array.isArray(args["addresses"])) contact["Addresses"] = args["addresses"];
        const r = await xeroFetch("/Contacts", {
          method: "PUT",
          body: { Contacts: [contact] },
          ...opts,
        });
        if (!r.ok) return r;
        return {
          ok: true,
          output: jsonOutput({
            action: "created",
            contact: xeroFirstEntity(r.data, "Contacts") ?? contact,
          }),
        };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_project_to_invoice",
      description:
        "WHAT: Create a sales invoice from unbilled project time (grouped by task).\n" +
        "WHEN: Bill client for logged hours — uses task rates from xero_list_project_tasks.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          ...idArg("project_id", "ProjectId GUID."),
          from_date: { type: "string", description: "YYYY-MM-DD — only time on/after this date." },
          to_date: { type: "string", description: "YYYY-MM-DD — only time on/before this date." },
          unbilled_only: {
            type: "boolean",
            description: "Skip time entries already INVOICED (default true).",
          },
          authorise: { type: "boolean", description: "Authorise invoice after create." },
          reference: { type: "string" },
        },
        required: ["project_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const projectId = String(args["project_id"] ?? "").trim();
        if (!projectId) return { ok: false, error: "project_id required" };
        const opts = { accountHint: xeroHint(args), tenantId: xeroTenant(args) };

        const projR = await xeroFetch(`/Projects/${encodeURIComponent(projectId)}`, {
          ...PROJECTS_OPTS,
          ...opts,
        });
        if (!projR.ok) return projR;
        const project =
          projR.data && typeof projR.data === "object"
            ? (projR.data as Record<string, unknown>)
            : null;
        const contactId =
          typeof project?.["contactId"] === "string" ? project["contactId"].trim() : "";
        if (!contactId) return { ok: false, error: "project has no contactId" };

        const tasksR = await xeroFetch(`/Projects/${encodeURIComponent(projectId)}/Tasks`, {
          ...PROJECTS_OPTS,
          ...opts,
        });
        if (!tasksR.ok) return tasksR;
        const tasks = xeroEntityArray(tasksR.data, "items").length
          ? xeroEntityArray(tasksR.data, "items")
          : Array.isArray(tasksR.data)
            ? (tasksR.data as Record<string, unknown>[])
            : xeroEntityArray(tasksR.data, "tasks");
        const tasksById = new Map<string, Record<string, unknown>>();
        for (const t of tasks) {
          const id = String(t["taskId"] ?? t["TaskId"] ?? "").trim();
          if (id) tasksById.set(id, t);
        }

        const timeR = await xeroFetch(`/Projects/${encodeURIComponent(projectId)}/Time`, {
          ...PROJECTS_OPTS,
          ...opts,
        });
        if (!timeR.ok) return timeR;
        const entries = xeroEntityArray(timeR.data, "items").length
          ? xeroEntityArray(timeR.data, "items")
          : Array.isArray(timeR.data)
            ? (timeR.data as Record<string, unknown>[])
            : xeroEntityArray(timeR.data, "timeEntries");

        const agg = aggregateProjectTimeByTask(entries, tasksById, {
          fromDate: typeof args["from_date"] === "string" ? args["from_date"].trim() : undefined,
          toDate: typeof args["to_date"] === "string" ? args["to_date"].trim() : undefined,
          unbilledOnly: args["unbilled_only"] !== false,
        });
        if (!agg.ok) return agg;

        const norm = normalizeXeroLineItems(agg.lineItems, { requireTaxType: false });
        if (!norm.ok) return { ok: false, error: norm.error };

        const projectName = String(project?.["name"] ?? "Project").trim();
        const invoice: Record<string, unknown> = {
          Type: "ACCREC",
          Contact: { ContactID: contactId },
          LineItems: norm.lineItems,
          Status: "DRAFT",
          LineAmountTypes: "Exclusive",
          Reference:
            typeof args["reference"] === "string" && args["reference"].trim()
              ? args["reference"].trim()
              : `${projectName} time`,
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
            project_id: projectId,
            contact_id: contactId,
            total_minutes: agg.totalMinutes,
            line_count: norm.lineItems.length,
            invoice: created,
            authorised: args["authorise"] === true,
          }),
        };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_month_end_close",
      description:
        "WHAT: Fetch key month-end reports and return a close checklist with summaries.\n" +
        "WHEN: Month-end / quarter-end close — read-only report bundle.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          fromDate: { type: "string", description: "YYYY-MM-DD period start." },
          toDate: { type: "string", description: "YYYY-MM-DD period end." },
          include_tax_summary: { type: "boolean", description: "Include GST/tax summary (default true)." },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const opts = { accountHint: xeroHint(args), tenantId: xeroTenant(args) };
        const params = xeroReportParams(args);
        const [pnl, bs, trial, agedAr, agedAp, bank] = await Promise.all([
          xeroFetch(xeroPathWithQuery("/Reports/ProfitAndLoss", params), opts),
          xeroFetch(xeroPathWithQuery("/Reports/BalanceSheet", params), opts),
          xeroFetch(xeroPathWithQuery("/Reports/TrialBalance", params), opts),
          xeroFetch(xeroPathWithQuery("/Reports/AgedReceivablesByContact", params), opts),
          xeroFetch(xeroPathWithQuery("/Reports/AgedPayablesByContact", params), opts),
          xeroFetch(xeroPathWithQuery("/Reports/BankSummary", params), opts),
        ]);
        const includeTax = args["include_tax_summary"] !== false;
        const tax = includeTax
          ? await xeroFetch(xeroPathWithQuery("/Reports/TaxSummary", params), opts)
          : null;

        const checklist = [
          { step: 1, task: "Review P&L for anomalies", tool: "xero_report_profit_and_loss" },
          { step: 2, task: "Reconcile balance sheet", tool: "xero_report_balance_sheet" },
          { step: 3, task: "Verify trial balance balances", tool: "xero_report_trial_balance" },
          { step: 4, task: "Chase aged receivables", tool: "xero_report_aged_receivables" },
          { step: 5, task: "Schedule aged payables", tool: "xero_report_aged_payables" },
          { step: 6, task: "Confirm bank balances vs statements", tool: "xero_report_bank_summary" },
          { step: 7, task: "Code uncleared bank lines", tool: "xero_list_bank_transactions" },
          { step: 8, task: "Post accruals / manual journals", tool: "xero_create_manual_journal" },
          ...(includeTax
            ? [{ step: 9, task: "Prepare BAS/GST from tax summary", tool: "xero_report_tax_summary" }]
            : []),
        ];

        return {
          ok: true,
          output: jsonOutput({
            period: { fromDate: params.get("fromDate"), toDate: params.get("toDate") },
            checklist,
            reports: {
              profit_and_loss: pnl.ok ? pnl.data : { error: pnl.error },
              balance_sheet: bs.ok ? bs.data : { error: bs.error },
              trial_balance: trial.ok ? trial.data : { error: trial.error },
              aged_receivables: agedAr.ok ? agedAr.data : { error: agedAr.error },
              aged_payables: agedAp.ok ? agedAp.data : { error: agedAp.error },
              bank_summary: bank.ok ? bank.data : { error: bank.error },
              ...(tax ? { tax_summary: tax.ok ? tax.data : { error: tax.error } } : {}),
            },
          }),
        };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_duplicate_invoice_check",
      description:
        "WHAT: Find likely duplicate invoices/bills for a contact (reference, number, or amount).\n" +
        "WHEN: Before creating invoices — prevent double-billing.",
      parameters: {
        type: "object",
        properties: {
          ...COMMON,
          contact_id: { type: "string" },
          reference: { type: "string" },
          invoice_number: { type: "string" },
          amount: { type: "number", description: "Total incl/excl — matched within 0.01." },
          type: { type: "string", enum: ["ACCREC", "ACCPAY"], description: "Default ACCREC." },
          days_back: { type: "number", description: "Look back N days from today (default 90)." },
        },
        required: ["contact_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 30_000,
      handler: async (args): Promise<ToolResult> => {
        const contactId = String(args["contact_id"] ?? "").trim();
        if (!contactId) return { ok: false, error: "contact_id required" };
        const type = String(args["type"] ?? "ACCREC").toUpperCase();
        const daysBack =
          typeof args["days_back"] === "number" && args["days_back"] > 0
            ? Math.floor(args["days_back"])
            : 90;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysBack);
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        const params = new URLSearchParams();
        params.set("where", `Contact.ContactID==Guid("${contactId}")&&Type=="${type}"`);
        params.set("order", "Date DESC");
        const r = await xeroFetch(xeroPathWithQuery("/Invoices", params), {
          accountHint: xeroHint(args),
          tenantId: xeroTenant(args),
        });
        if (!r.ok) return r;

        const ref =
          typeof args["reference"] === "string" ? args["reference"].trim().toLowerCase() : "";
        const invNum =
          typeof args["invoice_number"] === "string"
            ? args["invoice_number"].trim().toLowerCase()
            : "";
        const amount = typeof args["amount"] === "number" ? args["amount"] : undefined;
        if (!ref && !invNum && amount == null) {
          return {
            ok: false,
            error: "provide reference, invoice_number, and/or amount to check for duplicates",
          };
        }

        const matches: Record<string, unknown>[] = [];
        for (const inv of xeroEntityArray(r.data, "Invoices")) {
          const date = String(inv["Date"] ?? "").slice(0, 10);
          if (date && date < cutoffStr) continue;
          let hit = false;
          if (ref && String(inv["Reference"] ?? "").toLowerCase() === ref) hit = true;
          if (invNum && String(inv["InvoiceNumber"] ?? "").toLowerCase() === invNum) hit = true;
          if (amount != null) {
            const total = Number(inv["Total"]);
            if (Number.isFinite(total) && Math.abs(total - amount) < 0.02) hit = true;
          }
          if (hit) {
            matches.push({
              InvoiceID: inv["InvoiceID"],
              InvoiceNumber: inv["InvoiceNumber"],
              Reference: inv["Reference"],
              Status: inv["Status"],
              Date: inv["Date"],
              Total: inv["Total"],
            });
          }
        }

        return {
          ok: true,
          output: jsonOutput({
            contact_id: contactId,
            type,
            days_back: daysBack,
            match_count: matches.length,
            likely_duplicates: matches.slice(0, 20),
            hint:
              matches.length > 0
                ? "Review matches before creating a new invoice with the same reference/amount."
                : "No strong duplicates found for the given criteria.",
          }),
        };
      },
    })
  );
}
