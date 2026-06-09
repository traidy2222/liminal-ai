/**
 * Xero Accounting API REST tools (OAuth + tenant header).
 */
import type { ToolRegistry, ToolResult } from "@liminal/core";
import {
  effectiveHarnessEnvRaw,
  getXeroAccessToken,
  listXeroOAuthAccounts,
  readOAuthBundle,
  resolveXeroTenantId,
  type OAuthTokenBundle,
} from "@liminal/core";
import { defineTool } from "./helpers.js";
import { integrationNotConnectedError } from "./integration_oauth_start.js";

const XERO_API = "https://api.xero.com/api.xro/2.0";

export function xeroRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_XERO_REST") !== "0";
}

async function resolveXeroAuth(accountHint?: string): Promise<{
  token: string;
  bundle: OAuthTokenBundle;
} | null> {
  const accounts = await listXeroOAuthAccounts();
  const match = accountHint
    ? accounts.find(
        (a) =>
          a.accountId === accountHint ||
          a.email?.toLowerCase() === accountHint.toLowerCase()
      )
    : accounts[0];
  const accountId = match?.accountId ?? accounts[0]?.accountId;
  const token = await getXeroAccessToken(accountId);
  if (!token) return null;
  const bundle = await readOAuthBundle("xero", accountId);
  if (!bundle) return null;
  return { token, bundle };
}

async function xeroFetch(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    accountHint?: string;
    tenantId?: string;
  }
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const auth = await resolveXeroAuth(opts.accountHint);
  if (!auth) {
    return {
      ok: false,
      error:
        integrationNotConnectedError("xero"),
    };
  }
  const tenantId = resolveXeroTenantId(auth.bundle, opts.tenantId);
  if (!tenantId) {
    return { ok: false, error: "no Xero organisation (tenant) on this connection — reconnect Xero" };
  }
  const url = path.startsWith("http") ? path : `${XERO_API}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "xero-tenant-id": tenantId,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* plain text */
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "Message" in data
        ? String((data as { Message?: string }).Message)
        : text.slice(0, 400);
    return { ok: false, error: `Xero HTTP ${res.status}: ${msg}` };
  }
  return { ok: true, data };
}

function jsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function registerXeroRestTools(registry: ToolRegistry): void {
  if (!xeroRestEnabled()) return;

  registry.register(
    defineTool({
      name: "xero_list_organisations",
      description:
        "WHAT: List Xero organisations (tenants) linked to the connected account.\n" +
        "WHEN: User asks which Xero org is active or needs tenant_id for another call.",
      parameters: {
        type: "object",
        properties: {
          account_hint: { type: "string", description: "Optional account email or id." },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const auth = await resolveXeroAuth(
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!auth) return { ok: false, error: integrationNotConnectedError("xero") };
        const meta = auth.bundle.metadata as { tenants?: unknown[] } | undefined;
        return { ok: true, output: jsonOutput(meta?.tenants ?? []) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_invoices",
      description: "WHAT: List invoices in the connected Xero organisation.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED, etc." },
          page: { type: "number", description: "Page number (1-based)." },
          account_hint: { type: "string" },
          tenant_id: { type: "string", description: "Override organisation tenant id." },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = new URLSearchParams();
        if (typeof args["status"] === "string" && args["status"].trim()) {
          params.set("Statuses", args["status"].trim());
        }
        if (typeof args["page"] === "number" && args["page"] > 0) {
          params.set("page", String(Math.floor(args["page"])));
        }
        const q = params.toString();
        const r = await xeroFetch(`/Invoices${q ? `?${q}` : ""}`, {
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
          tenantId: typeof args["tenant_id"] === "string" ? args["tenant_id"] : undefined,
        });
        if (!r.ok) return r;
        return { ok: true, output: jsonOutput(r.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_get_invoice",
      description: "WHAT: Fetch one invoice by InvoiceID GUID.",
      parameters: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "Xero InvoiceID (GUID)." },
          account_hint: { type: "string" },
          tenant_id: { type: "string" },
        },
        required: ["invoice_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["invoice_id"] ?? "").trim();
        if (!id) return { ok: false, error: "invoice_id required" };
        const r = await xeroFetch(`/Invoices/${encodeURIComponent(id)}`, {
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
          tenantId: typeof args["tenant_id"] === "string" ? args["tenant_id"] : undefined,
        });
        if (!r.ok) return r;
        return { ok: true, output: jsonOutput(r.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "xero_list_contacts",
      description: "WHAT: List contacts (customers/suppliers) in Xero.",
      parameters: {
        type: "object",
        properties: {
          where: { type: "string", description: "Optional Xero where filter, e.g. Name.Contains(\"Acme\")" },
          page: { type: "number" },
          account_hint: { type: "string" },
          tenant_id: { type: "string" },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const params = new URLSearchParams();
        if (typeof args["where"] === "string" && args["where"].trim()) {
          params.set("where", args["where"].trim());
        }
        if (typeof args["page"] === "number" && args["page"] > 0) {
          params.set("page", String(Math.floor(args["page"])));
        }
        const q = params.toString();
        const r = await xeroFetch(`/Contacts${q ? `?${q}` : ""}`, {
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
          tenantId: typeof args["tenant_id"] === "string" ? args["tenant_id"] : undefined,
        });
        if (!r.ok) return r;
        return { ok: true, output: jsonOutput(r.data) };
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
          contact_id: { type: "string", description: "Xero ContactID for the customer." },
          line_items: {
            type: "array",
            description: "Line items with Description, Quantity, UnitAmount, AccountCode.",
            items: { type: "object" },
          },
          reference: { type: "string" },
          due_date: { type: "string", description: "YYYY-MM-DD" },
          account_hint: { type: "string" },
          tenant_id: { type: "string" },
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
        const invoice: Record<string, unknown> = {
          Type: "ACCREC",
          Contact: { ContactID: contactId },
          LineItems: lineItems,
          Status: "DRAFT",
        };
        if (typeof args["reference"] === "string" && args["reference"].trim()) {
          invoice["Reference"] = args["reference"].trim();
        }
        if (typeof args["due_date"] === "string" && args["due_date"].trim()) {
          invoice["DueDate"] = args["due_date"].trim();
        }
        const r = await xeroFetch("/Invoices", {
          method: "PUT",
          body: { Invoices: [invoice] },
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
          tenantId: typeof args["tenant_id"] === "string" ? args["tenant_id"] : undefined,
        });
        if (!r.ok) return r;
        return { ok: true, output: jsonOutput(r.data) };
      },
    })
  );
}
