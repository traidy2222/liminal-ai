/**
 * Stripe Connect REST tools (OAuth access token per connected account).
 */
import type { ToolRegistry, ToolResult } from "@liminal/core";
import {
  effectiveHarnessEnvRaw,
  getStripeAccessToken,
  listStripeOAuthAccounts,
  readOAuthBundle,
  type OAuthTokenBundle,
} from "@liminal/core";
import { defineTool } from "./helpers.js";

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2024-06-20";

export function stripeRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_STRIPE_REST") !== "0";
}

async function resolveStripeAuth(accountHint?: string): Promise<{
  token: string;
  bundle: OAuthTokenBundle;
} | null> {
  const accounts = await listStripeOAuthAccounts();
  const match = accountHint
    ? accounts.find(
        (a) =>
          a.accountId === accountHint ||
          a.stripeUserId === accountHint ||
          a.email?.toLowerCase() === accountHint.toLowerCase() ||
          a.businessName?.toLowerCase() === accountHint.toLowerCase()
      )
    : accounts[0];
  const accountId = match?.accountId ?? accounts[0]?.accountId;
  const token = await getStripeAccessToken(accountId);
  if (!token) return null;
  const bundle = await readOAuthBundle("stripe", accountId);
  if (!bundle) return null;
  return { token, bundle };
}

function stripeWriteAllowed(bundle: OAuthTokenBundle): boolean {
  const mode = bundle.metadata?.mode;
  if (mode === "read_only") return false;
  return bundle.scopes.some((s) => s === "read_write" || s.includes("write"));
}

async function stripeRequest(opts: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  form?: Record<string, string | number | boolean | undefined>;
  accountHint?: string;
}): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const auth = await resolveStripeAuth(opts.accountHint);
  if (!auth) {
    return {
      ok: false,
      error:
        "Stripe not connected — Settings → Integrations → Connect Stripe, or `liminal connect stripe`.",
    };
  }

  let url = opts.path.startsWith("http") ? opts.path : `${STRIPE_API}${opts.path.startsWith("/") ? opts.path : `/${opts.path}`}`;
  if (opts.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };

  let body: string | undefined;
  if (opts.form && opts.method !== "GET") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.form)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    body = params.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const res = await fetch(url, { method: opts.method, headers, body });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* plain */
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? text.slice(0, 400))
        : text.slice(0, 400);
    return { ok: false, error: `Stripe HTTP ${res.status}: ${msg}` };
  }
  return { ok: true, data };
}

function jsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function accountHintProp() {
  return { type: "string" as const, description: "Optional Stripe account id (acct_…) or label." };
}

export function registerStripeRestTools(registry: ToolRegistry): void {
  if (!stripeRestEnabled()) return;

  registry.register(
    defineTool({
      name: "stripe_get_account",
      description:
        "WHEN: User asks about their Stripe business account settings or mode.\n" +
        "HOW: Returns the connected Stripe account object.",
      parameters: {
        type: "object",
        properties: { account_hint: accountHintProp() },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const result = await stripeRequest({
          method: "GET",
          path: "/account",
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_get_balance",
      description: "WHEN: User asks for Stripe balance or available/pending funds.",
      parameters: {
        type: "object",
        properties: { account_hint: accountHintProp() },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 30_000,
      handler: async (args): Promise<ToolResult> => {
        const result = await stripeRequest({
          method: "GET",
          path: "/balance",
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_list_customers",
      description: "WHEN: User wants Stripe customers list or to find a customer by email.",
      parameters: {
        type: "object",
        properties: {
          account_hint: accountHintProp(),
          limit: { type: "number", description: "Max rows (default 20, max 100)." },
          email: { type: "string", description: "Filter by email." },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 30_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(100, Math.max(1, Number(args["limit"]) || 20));
        const result = await stripeRequest({
          method: "GET",
          path: "/customers",
          query: {
            limit,
            email: typeof args["email"] === "string" ? args["email"] : undefined,
          },
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_get_customer",
      description: "WHEN: User needs one Stripe customer by id (cus_…).",
      parameters: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "Stripe customer id cus_…" },
          account_hint: accountHintProp(),
        },
        required: ["customer_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["customer_id"] ?? "").trim();
        if (!id) return { ok: false, error: "customer_id required" };
        const result = await stripeRequest({
          method: "GET",
          path: `/customers/${encodeURIComponent(id)}`,
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_list_subscriptions",
      description: "WHEN: User asks about MRR, active subscriptions, or churn.",
      parameters: {
        type: "object",
        properties: {
          account_hint: accountHintProp(),
          limit: { type: "number" },
          status: {
            type: "string",
            description: "Filter: active, canceled, all, etc.",
          },
          customer_id: { type: "string", description: "Optional cus_… filter." },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 30_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(100, Math.max(1, Number(args["limit"]) || 20));
        const result = await stripeRequest({
          method: "GET",
          path: "/subscriptions",
          query: {
            limit,
            status: typeof args["status"] === "string" ? args["status"] : undefined,
            customer: typeof args["customer_id"] === "string" ? args["customer_id"] : undefined,
          },
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_get_subscription",
      description: "WHEN: User needs details for one subscription sub_…",
      parameters: {
        type: "object",
        properties: {
          subscription_id: { type: "string" },
          account_hint: accountHintProp(),
        },
        required: ["subscription_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["subscription_id"] ?? "").trim();
        if (!id) return { ok: false, error: "subscription_id required" };
        const result = await stripeRequest({
          method: "GET",
          path: `/subscriptions/${encodeURIComponent(id)}`,
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_list_invoices",
      description: "WHEN: User asks for invoices, billing history, or unpaid invoices.",
      parameters: {
        type: "object",
        properties: {
          account_hint: accountHintProp(),
          limit: { type: "number" },
          customer_id: { type: "string" },
          status: { type: "string", description: "draft, open, paid, uncollectible, void" },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 30_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(100, Math.max(1, Number(args["limit"]) || 20));
        const result = await stripeRequest({
          method: "GET",
          path: "/invoices",
          query: {
            limit,
            customer: typeof args["customer_id"] === "string" ? args["customer_id"] : undefined,
            status: typeof args["status"] === "string" ? args["status"] : undefined,
          },
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_get_invoice",
      description: "WHEN: User needs one invoice in_…",
      parameters: {
        type: "object",
        properties: {
          invoice_id: { type: "string" },
          account_hint: accountHintProp(),
        },
        required: ["invoice_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["invoice_id"] ?? "").trim();
        if (!id) return { ok: false, error: "invoice_id required" };
        const result = await stripeRequest({
          method: "GET",
          path: `/invoices/${encodeURIComponent(id)}`,
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_list_charges",
      description: "WHEN: User asks about recent payments or charges.",
      parameters: {
        type: "object",
        properties: {
          account_hint: accountHintProp(),
          limit: { type: "number" },
          customer_id: { type: "string" },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 30_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(100, Math.max(1, Number(args["limit"]) || 20));
        const result = await stripeRequest({
          method: "GET",
          path: "/charges",
          query: {
            limit,
            customer: typeof args["customer_id"] === "string" ? args["customer_id"] : undefined,
          },
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_get_charge",
      description: "WHEN: User needs one charge ch_…",
      parameters: {
        type: "object",
        properties: {
          charge_id: { type: "string" },
          account_hint: accountHintProp(),
        },
        required: ["charge_id"],
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (args): Promise<ToolResult> => {
        const id = String(args["charge_id"] ?? "").trim();
        if (!id) return { ok: false, error: "charge_id required" };
        const result = await stripeRequest({
          method: "GET",
          path: `/charges/${encodeURIComponent(id)}`,
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_list_products",
      description: "WHEN: User asks what products/prices exist in Stripe.",
      parameters: {
        type: "object",
        properties: {
          account_hint: accountHintProp(),
          limit: { type: "number" },
          active: { type: "boolean" },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(100, Math.max(1, Number(args["limit"]) || 20));
        const result = await stripeRequest({
          method: "GET",
          path: "/products",
          query: {
            limit,
            active: args["active"] === true ? true : args["active"] === false ? false : undefined,
          },
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_create_refund",
      description:
        "WHEN: User explicitly asks to refund a Stripe charge or payment.\n" +
        "REQUIRES: read_write Stripe connection. Approval required.",
      parameters: {
        type: "object",
        properties: {
          charge_id: { type: "string", description: "ch_… or py_…" },
          amount: { type: "number", description: "Optional partial refund in cents." },
          reason: {
            type: "string",
            enum: ["duplicate", "fraudulent", "requested_by_customer"],
          },
          account_hint: accountHintProp(),
        },
        required: ["charge_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const auth = await resolveStripeAuth(
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!auth) return { ok: false, error: "Stripe not connected" };
        if (!stripeWriteAllowed(auth.bundle)) {
          return { ok: false, error: "Stripe connection is read-only — reconnect with read_write" };
        }
        const chargeId = String(args["charge_id"] ?? "").trim();
        if (!chargeId) return { ok: false, error: "charge_id required" };
        const form: Record<string, string | number> = { charge: chargeId };
        if (typeof args["amount"] === "number" && args["amount"] > 0) {
          form.amount = Math.floor(args["amount"]);
        }
        if (typeof args["reason"] === "string") form.reason = args["reason"];
        const result = await stripeRequest({
          method: "POST",
          path: "/refunds",
          form,
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stripe_cancel_subscription",
      description:
        "WHEN: User explicitly asks to cancel a Stripe subscription.\n" +
        "REQUIRES: read_write connection. Approval required.",
      parameters: {
        type: "object",
        properties: {
          subscription_id: { type: "string" },
          at_period_end: {
            type: "boolean",
            description: "If true, cancel at period end instead of immediately.",
          },
          account_hint: accountHintProp(),
        },
        required: ["subscription_id"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const auth = await resolveStripeAuth(
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!auth) return { ok: false, error: "Stripe not connected" };
        if (!stripeWriteAllowed(auth.bundle)) {
          return { ok: false, error: "Stripe connection is read-only — reconnect with read_write" };
        }
        const id = String(args["subscription_id"] ?? "").trim();
        if (!id) return { ok: false, error: "subscription_id required" };
        if (args["at_period_end"] === true) {
          const result = await stripeRequest({
            method: "POST",
            path: `/subscriptions/${encodeURIComponent(id)}`,
            form: { cancel_at_period_end: true },
            accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
          });
          if (!result.ok) return { ok: false, error: result.error };
          return { ok: true, output: jsonOutput(result.data) };
        }
        const result = await stripeRequest({
          method: "DELETE",
          path: `/subscriptions/${encodeURIComponent(id)}`,
          accountHint: typeof args["account_hint"] === "string" ? args["account_hint"] : undefined,
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );
}
