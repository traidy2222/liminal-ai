/**
 * Slack Web API transport — form-urlencoded POST (canonical for user tokens).
 * JSON bodies break several methods (search.messages, conversations.replies) with invalid_arguments.
 */
import { getSlackAccessToken, listSlackOAuthAccounts } from "@liminal/core";
import { integrationNotConnectedError } from "../core/integration_oauth_start.js";
import { formatSlackApiError } from "./slack_scope_probe.js";

const SLACK_API = "https://slack.com/api";

export function slackEncodeFields(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object") {
      out[key] = JSON.stringify(value);
    } else if (typeof value === "boolean") {
      out[key] = value ? "true" : "false";
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

export async function callSlackApi(
  method: string,
  params: Record<string, unknown>,
  accountHint?: string
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const token = await resolveSlackToken(accountHint);
  if (!token) {
    return { ok: false, error: integrationNotConnectedError("slack") };
  }
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    },
    body: new URLSearchParams(slackEncodeFields(params)),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    response_metadata?: { messages?: string[] };
    [key: string]: unknown;
  };
  if (!res.ok || data.ok === false) {
    return {
      ok: false,
      error: await formatSlackApiError(data, accountHint, res.status),
    };
  }
  return { ok: true, data };
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
