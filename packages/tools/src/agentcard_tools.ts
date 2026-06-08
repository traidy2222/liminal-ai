/**
 * AgentCard harness tools — capped virtual cards, agent email, Base USDC / x402.
 * Canonical workflow: https://agentcard.ai/skill
 */
import type { ToolDefinition, ToolResult, ToolRegistry } from "@liminal/core";
import { defineTool } from "./helpers.js";
import {
  agentcardEnabled,
  execAgentcard,
  formatAgentcardOutput,
  normalizeAgentcardCardAmount,
  resolveAgentcardSignupTimeoutMs,
  resolveAgentcardTimeoutMs,
} from "./agentcard_cli.js";
import { TOOL_FAMILIES } from "./tool_catalog.js";

async function run(args: string[], opts?: { timeoutMs?: number }): Promise<ToolResult> {
  const res = await execAgentcard(args, opts);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, output: formatAgentcardOutput(res) };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function createAgentcardTools(): ToolDefinition[] {
  const agentcardWhoami = defineTool({
    name: "agentcard_whoami",
    description: "Show the logged-in AgentCard account (or not-logged-in hint).",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => run(["whoami"]),
  });

  const agentcardSignup = defineTool({
    name: "agentcard_signup",
    description:
      "Sign up or log in to AgentCard. Sends a magic link and polls for up to ~5 minutes — tell the user to click the email link and wait.",
    requiresApproval: true,
    dangerLevel: "destructive",
    parameters: {
      type: "object",
      properties: {
        email: { type: "string", description: "Account email for the magic link." },
      },
      required: ["email"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const email = str(args["email"]);
      if (!email) return { ok: false, error: "email is required" };
      return run(["signup", "--email", email], { timeoutMs: resolveAgentcardSignupTimeoutMs() });
    },
  });

  const agentcardSetup = defineTool({
    name: "agentcard_setup",
    description:
      "Set up or refresh AgentCard profile, Stripe payment hold method, @agentcard.email inbox, and Base wallet. Idempotent. Relay any Stripe setup URL to the user.",
    requiresApproval: true,
    dangerLevel: "destructive",
    parameters: {
      type: "object",
      properties: {
        first_name: { type: "string" },
        last_name: { type: "string" },
        phone: { type: "string", description: "E.164 phone, e.g. +14155551234" },
        reset: { type: "boolean", description: "Replace existing setup (only when user asked)." },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const argv = ["setup"];
      const first = str(args["first_name"]);
      const last = str(args["last_name"]);
      const phone = str(args["phone"]);
      if (first) argv.push("--first-name", first);
      if (last) argv.push("--last-name", last);
      if (phone) argv.push("--phone", phone);
      if (args["reset"] === true) argv.push("--reset");
      return run(argv, { timeoutMs: resolveAgentcardTimeoutMs() });
    },
  });

  const agentcardLimit = defineTool({
    name: "agentcard_limit",
    description: "Show AgentCard spend limit and remaining budget.",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 10_000,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => run(["limit"]),
  });

  const agentcardLimitRequest = defineTool({
    name: "agentcard_limit_request",
    description:
      "Request a higher AgentCard spend limit. Emails the account owner an approval link — tell the user to approve before retrying payment.",
    requiresApproval: true,
    dangerLevel: "destructive",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Requested spend limit in USD." },
      },
      required: ["amount"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const n = typeof args["amount"] === "number" ? args["amount"] : parseFloat(String(args["amount"] ?? ""));
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "amount must be a positive number" };
      return run(["limit", "--amount", String(Math.round(n))]);
    },
  });

  const agentcardCardRequest = defineTool({
    name: "agentcard_card_request",
    description:
      "Issue a capped single-use virtual card (live 7 days). Amount = checkout total rounded UP to next whole USD (1–150). Use printed PAN/CVV at merchant checkout — do not paste card secrets into chat unless the user needs them in-browser.",
    requiresApproval: true,
    dangerLevel: "destructive",
    parameters: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description: "Card cap in whole USD dollars (round checkout total up, max 150).",
        },
      },
      required: ["amount"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const norm = normalizeAgentcardCardAmount(args["amount"]);
      if (!norm.ok) return { ok: false, error: norm.error };
      return run(["request", "new", "--amount", String(norm.amount)]);
    },
  });

  const agentcardCardList = defineTool({
    name: "agentcard_card_list",
    description: "List AgentCard virtual card requests.",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 10_000,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => run(["request", "get"]),
  });

  const agentcardCardGet = defineTool({
    name: "agentcard_card_get",
    description: "Re-fetch live details for one card request (PAN, CVV, billing fields).",
    requiresApproval: true,
    dangerLevel: "destructive",
    parameters: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "Card request id from agentcard_card_request output." },
      },
      required: ["request_id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const id = str(args["request_id"]);
      if (!id) return { ok: false, error: "request_id is required" };
      return run(["request", "get", id]);
    },
  });

  const agentcard3ds = defineTool({
    name: "agentcard_3ds",
    description:
      "Fetch recent 3DS / card verification codes after checkout prompts. Pick the code matching the checkout charge amount.",
    requiresApproval: false,
    cacheable: false,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => run(["3ds"], { timeoutMs: 30_000 }),
  });

  const agentcardMailInfo = defineTool({
    name: "agentcard_mail_info",
    description: "Show the dedicated @agentcard.email inbox address.",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => run(["mail", "info"]),
  });

  const agentcardMailList = defineTool({
    name: "agentcard_mail_list",
    description: "List threads in the agent email inbox.",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 5_000,
    parameters: {
      type: "object",
      properties: {
        include_sent: { type: "boolean", description: "Include sent threads." },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const argv = ["mail", "list"];
      if (args["include_sent"] === true) argv.push("--include-sent");
      return run(argv);
    },
  });

  const agentcardMailGet = defineTool({
    name: "agentcard_mail_get",
    description: "Read one agent email thread (verification codes, receipts). Enter codes directly at the merchant — avoid pasting into chat.",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 5_000,
    parameters: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
      },
      required: ["thread_id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const threadId = str(args["thread_id"]);
      if (!threadId) return { ok: false, error: "thread_id is required" };
      return run(["mail", "get", threadId]);
    },
  });

  const agentcardMailSend = defineTool({
    name: "agentcard_mail_send",
    description: "Send email from the @agentcard.email inbox (user-approved communication only).",
    requiresApproval: true,
    dangerLevel: "destructive",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
      },
      required: ["to", "subject", "body"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const to = str(args["to"]);
      const subject = str(args["subject"]);
      const body = str(args["body"]);
      if (!to || !subject || !body) return { ok: false, error: "to, subject, and body are required" };
      return run(["mail", "send", "--to", to, "--subject", subject, "--body", body]);
    },
  });

  const agentcardMailReply = defineTool({
    name: "agentcard_mail_reply",
    description: "Reply to an agent email thread.",
    requiresApproval: true,
    dangerLevel: "destructive",
    parameters: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
        body: { type: "string" },
      },
      required: ["thread_id", "body"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const threadId = str(args["thread_id"]);
      const body = str(args["body"]);
      if (!threadId || !body) return { ok: false, error: "thread_id and body are required" };
      return run(["mail", "reply", threadId, "--body", body]);
    },
  });

  const agentcardWalletInfo = defineTool({
    name: "agentcard_wallet_info",
    description: "Show Base USDC wallet address and metadata.",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => run(["wallet", "info"]),
  });

  const agentcardWalletBalance = defineTool({
    name: "agentcard_wallet_balance",
    description: "Print AgentCard wallet USDC balance.",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 10_000,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => run(["wallet", "balance"]),
  });

  const agentcardWalletFetch = defineTool({
    name: "agentcard_wallet_fetch",
    description:
      "HTTP fetch with x402 USDC payment on Base. Always pass max_cost unless the user approved any charge. Response body prints to stdout.",
    requiresApproval: true,
    dangerLevel: "destructive",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        max_cost: { type: "number", description: "Max USDC spend (decimal, e.g. 0.15 for 15 cents)." },
        method: { type: "string", description: "HTTP method (default GET)." },
        headers: {
          type: "array",
          items: { type: "string" },
          description: 'Optional headers as "Name: Value" strings (one per -H flag).',
        },
        body: { type: "string", description: "Optional request body (-d)." },
      },
      required: ["url", "max_cost"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const url = str(args["url"]);
      const maxCost = args["max_cost"];
      if (!url) return { ok: false, error: "url is required" };
      const cost = typeof maxCost === "number" ? maxCost : parseFloat(String(maxCost ?? ""));
      if (!Number.isFinite(cost) || cost <= 0) return { ok: false, error: "max_cost must be a positive USDC amount" };
      const argv = ["wallet", "fetch", url, "--max-cost", String(cost)];
      const method = str(args["method"]);
      if (method) argv.push("-X", method.toUpperCase());
      const headers = Array.isArray(args["headers"]) ? args["headers"] : [];
      for (const h of headers) {
        const line = str(h);
        if (line) argv.push("-H", line);
      }
      const body = str(args["body"]);
      if (body) argv.push("-d", body);
      return run(argv, { timeoutMs: resolveAgentcardTimeoutMs() });
    },
  });

  const agentcardWalletSend = defineTool({
    name: "agentcard_wallet_send",
    description: "Send USDC on Base to a recipient address. Confirm address and amount with the user first.",
    requiresApproval: true,
    dangerLevel: "destructive",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "0x recipient on Base." },
        amount: { type: "number", description: "USDC amount (decimal)." },
      },
      required: ["to", "amount"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const to = str(args["to"]);
      const amount = args["amount"];
      if (!to) return { ok: false, error: "to is required" };
      const n = typeof amount === "number" ? amount : parseFloat(String(amount ?? ""));
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "amount must be positive USDC" };
      return run(["wallet", "send", "--to", to, "--amount", String(n)]);
    },
  });

  const agentcardSupport = defineTool({
    name: "agentcard_support",
    description: "Report AgentCard checkout failures, declines, CAPTCHAs, or CLI errors to AgentCard support.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
        card_id: { type: "string" },
        url: { type: "string" },
        error: { type: "string" },
      },
      required: ["message"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const message = str(args["message"]);
      if (!message) return { ok: false, error: "message is required" };
      const argv = ["support", "--message", message];
      const cardId = str(args["card_id"]);
      const url = str(args["url"]);
      const err = str(args["error"]);
      if (cardId) argv.push("--card-id", cardId);
      if (url) argv.push("--url", url);
      if (err) argv.push("--error", err);
      return run(argv);
    },
  });

  return [
    agentcardWhoami,
    agentcardSignup,
    agentcardSetup,
    agentcardLimit,
    agentcardLimitRequest,
    agentcardCardRequest,
    agentcardCardList,
    agentcardCardGet,
    agentcard3ds,
    agentcardMailInfo,
    agentcardMailList,
    agentcardMailGet,
    agentcardMailSend,
    agentcardMailReply,
    agentcardWalletInfo,
    agentcardWalletBalance,
    agentcardWalletFetch,
    agentcardWalletSend,
    agentcardSupport,
  ];
}

/** Tool names for catalog registration. */
export const AGENTCARD_TOOL_NAMES = createAgentcardTools().map((t) => t.name);

/** AgentCard is lazy-loaded like other families — activate via activate_tool_family("agentcard"). */
export function bootstrapAgentcardTools(_registry: ToolRegistry): string[] {
  return [];
}
