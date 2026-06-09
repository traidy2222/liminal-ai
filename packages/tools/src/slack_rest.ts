/**
 * Slack Web API REST tools (user OAuth token).
 */
import type { ToolRegistry, ToolResult } from "@liminal/core";
import { effectiveHarnessEnvRaw, getSlackAccessToken, listSlackOAuthAccounts } from "@liminal/core";
import { defineTool } from "./helpers.js";
import { integrationNotConnectedError } from "./integration_oauth_start.js";
import { enrichSlackScopeError } from "./slack_scope_probe.js";

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

async function slackFormApi(
  method: string,
  fields: Record<string, string>,
  accountHint?: string
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const token = await resolveSlackToken(accountHint);
  if (!token) {
    return { ok: false, error: integrationNotConnectedError("slack") };
  }
  const body = new URLSearchParams(fields);
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body,
  });
  const data = (await res.json()) as { ok?: boolean; error?: string; [key: string]: unknown };
  if (!res.ok || data.ok === false) {
    return {
      ok: false,
      error: await enrichSlackScopeError(data, accountHint, res.status),
    };
  }
  return { ok: true, data };
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
      error: integrationNotConnectedError("slack"),
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
    return {
      ok: false,
      error: await enrichSlackScopeError(data, accountHint, res.status),
    };
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

  registry.register(
    defineTool({
      name: "slack_get_thread_replies",
      description:
        "WHEN: User asks for replies in a Slack thread.\n" +
        "HOW: channel id + thread_ts (parent message timestamp from history).",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Slack channel id." },
          thread_ts: { type: "string", description: "Parent message ts." },
          limit: { type: "number", description: "Max messages (default 50, max 200)." },
          account_hint: { type: "string" },
        },
        required: ["channel", "thread_ts"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 15_000,
      handler: async (args): Promise<ToolResult> => {
        const channel = String(args["channel"] ?? "").trim();
        const threadTs = String(args["thread_ts"] ?? "").trim();
        if (!channel || !threadTs) return { ok: false, error: "channel and thread_ts are required" };
        const limit = Math.min(200, Math.max(1, Number(args["limit"]) || 50));
        const result = await slackApi(
          "conversations.replies",
          { channel, ts: threadTs, limit },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "slack_reply_in_thread",
      description:
        "WHEN: User wants a reply in an existing Slack thread (not a new top-level message).\n" +
        "HOW: channel id + thread_ts + text. Approval required before posting.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string" },
          thread_ts: { type: "string" },
          text: { type: "string" },
          account_hint: { type: "string" },
        },
        required: ["channel", "thread_ts", "text"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const channel = String(args["channel"] ?? "").trim();
        const threadTs = String(args["thread_ts"] ?? "").trim();
        const text = String(args["text"] ?? "").trim();
        if (!channel || !threadTs || !text) {
          return { ok: false, error: "channel, thread_ts, and text are required" };
        }
        const result = await slackApi(
          "chat.postMessage",
          { channel, thread_ts: threadTs, text },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "slack_search_messages",
      description:
        "WHEN: User asks to find Slack messages by keyword or from a person.\n" +
        "HOW: Slack search query (e.g. `deploy in:#eng`, `from:@alice budget`).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Slack search query string." },
          count: { type: "number", description: "Max results (default 20, max 100)." },
          account_hint: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 30_000,
      handler: async (args): Promise<ToolResult> => {
        const query = String(args["query"] ?? "").trim();
        if (!query) return { ok: false, error: "query is required" };
        const count = Math.min(100, Math.max(1, Number(args["count"]) || 20));
        const result = await slackApi(
          "search.messages",
          { query, count, sort: "timestamp", sort_dir: "desc" },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "slack_open_dm",
      description:
        "WHEN: User wants to DM someone on Slack.\n" +
        "HOW: Pass Slack user id (U…) from slack_list_users; returns DM channel id (D…).",
      parameters: {
        type: "object",
        properties: {
          user: { type: "string", description: "Slack user id to open DM with." },
          account_hint: { type: "string" },
        },
        required: ["user"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const user = String(args["user"] ?? "").trim();
        if (!user) return { ok: false, error: "user is required" };
        const result = await slackApi(
          "conversations.open",
          { users: user },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "slack_list_dms",
      description: "WHEN: User wants open Slack DMs. HOW: Lists IM channels (excludes archived).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
          account_hint: { type: "string" },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 30_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(200, Math.max(1, Number(args["limit"]) || 50));
        const result = await slackApi(
          "conversations.list",
          { types: "im", exclude_archived: true, limit },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "slack_add_reaction",
      description:
        "WHEN: User wants to react to a Slack message.\n" +
        "HOW: channel + message timestamp + emoji name (no colons, e.g. thumbsup).",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string" },
          timestamp: { type: "string", description: "Message ts to react to." },
          name: { type: "string", description: "Emoji short name without colons." },
          account_hint: { type: "string" },
        },
        required: ["channel", "timestamp", "name"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const channel = String(args["channel"] ?? "").trim();
        const timestamp = String(args["timestamp"] ?? "").trim();
        const name = String(args["name"] ?? "").trim().replace(/^:+|:+$/g, "");
        if (!channel || !timestamp || !name) {
          return { ok: false, error: "channel, timestamp, and name are required" };
        }
        const result = await slackApi(
          "reactions.add",
          { channel, timestamp, name },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "slack_upload_file",
      description:
        "WHEN: User wants to share a file in Slack.\n" +
        "HOW: channel id + filename + text content (UTF-8). Approval required.",
      parameters: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel or DM id." },
          filename: { type: "string" },
          content: { type: "string", description: "File body (plain text / small files)." },
          initial_comment: { type: "string", description: "Optional message with the file." },
          account_hint: { type: "string" },
        },
        required: ["channel", "filename", "content"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const channel = String(args["channel"] ?? "").trim();
        const filename = String(args["filename"] ?? "").trim();
        const content = String(args["content"] ?? "");
        if (!channel || !filename) return { ok: false, error: "channel and filename are required" };
        const fields: Record<string, string> = { channels: channel, filename, content };
        const comment =
          typeof args["initial_comment"] === "string" ? args["initial_comment"].trim() : "";
        if (comment) fields.initial_comment = comment;
        const result = await slackFormApi(
          "files.upload",
          fields,
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );
}
