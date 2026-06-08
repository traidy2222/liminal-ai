/**
 * Slack Web API REST tools (user OAuth token).
 */
import type { ToolRegistry, ToolResult } from "@liminal/core";
import { effectiveHarnessEnvRaw, getSlackAccessToken, listSlackOAuthAccounts } from "@liminal/core";
import { defineTool } from "./helpers.js";

const SLACK_API = "https://slack.com/api";

export function slackRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_SLACK_REST") !== "0";
}

async function resolveSlackToken(accountHint?: string): Promise<string | null> {
  const accounts = await listSlackOAuthAccounts();
  const match = accountHint
    ? accounts.find(
        (a) =>
          a.accountId === accountHint ||
          a.teamName?.toLowerCase() === accountHint.toLowerCase()
      )
    : accounts[0];
  return getSlackAccessToken(match?.accountId ?? accounts[0]?.accountId);
}

async function slackApi(
  method: string,
  body: Record<string, unknown>,
  accountHint?: string
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const token = await resolveSlackToken(accountHint);
  if (!token) {
    return {
      ok: false,
      error:
        "Slack not connected — Settings → Integrations → Connect Slack (hosted sign-in, no .env setup).",
    };
  }
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string; [key: string]: unknown };
  if (!res.ok || data.ok === false) {
    return { ok: false, error: data.error ?? `Slack HTTP ${res.status}` };
  }
  return { ok: true, data };
}

function jsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function registerSlackRestTools(registry: ToolRegistry): void {
  if (!slackRestEnabled()) return;

  registry.register(
    defineTool({
      name: "slack_list_channels",
      description:
        "WHEN: User wants Slack channels the agent can read.\n" +
        "HOW: Returns public/private channels (excludes archived). Requires Slack integration.",
      parameters: {
        type: "object",
        properties: {
          account_hint: { type: "string", description: "Optional Slack account or team name." },
          limit: { type: "number", description: "Max channels (default 100, max 200)." },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 30_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(200, Math.max(1, Number(args["limit"]) || 100));
        const result = await slackApi(
          "conversations.list",
          { types: "public_channel,private_channel", exclude_archived: true, limit },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "slack_list_users",
      description: "WHEN: User needs Slack workspace members. HOW: Lists users (no bots by default).",
      parameters: {
        type: "object",
        properties: {
          account_hint: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(200, Math.max(1, Number(args["limit"]) || 100));
        const result = await slackApi(
          "users.list",
          { limit },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "slack_get_channel_history",
      description:
        "WHEN: User asks what was said in a Slack channel or DM.\n" +
        "HOW: Pass channel id (C…/G…/D…) from slack_list_channels.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Slack channel id." },
          limit: { type: "number", description: "Messages to fetch (default 20, max 100)." },
          account_hint: { type: "string" },
        },
        required: ["channel"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 15_000,
      handler: async (args): Promise<ToolResult> => {
        const channel = String(args["channel"] ?? "").trim();
        if (!channel) return { ok: false, error: "channel is required" };
        const limit = Math.min(100, Math.max(1, Number(args["limit"]) || 20));
        const result = await slackApi(
          "conversations.history",
          { channel, limit },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "slack_post_message",
      description:
        "WHEN: User wants to send a Slack message.\n" +
        "HOW: channel id + text (mrkdwn). Approval required before posting.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Slack channel id." },
          text: { type: "string", description: "Message body (Slack mrkdwn)." },
          thread_ts: { type: "string", description: "Optional thread parent timestamp." },
          account_hint: { type: "string" },
        },
        required: ["channel", "text"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const channel = String(args["channel"] ?? "").trim();
        const text = String(args["text"] ?? "").trim();
        if (!channel || !text) return { ok: false, error: "channel and text are required" };
        const body: Record<string, unknown> = { channel, text };
        const threadTs = typeof args["thread_ts"] === "string" ? args["thread_ts"].trim() : "";
        if (threadTs) body.thread_ts = threadTs;
        const result = await slackApi(
          "chat.postMessage",
          body,
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );
}
