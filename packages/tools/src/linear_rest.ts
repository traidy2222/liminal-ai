/**
 * Linear GraphQL REST tools (OAuth).
 */
import type { ToolRegistry, ToolResult } from "@liminal/core";
import { effectiveHarnessEnvRaw, getLinearAccessToken, listLinearOAuthAccounts } from "@liminal/core";
import { defineTool } from "./helpers.js";

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

export function linearRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_LINEAR_REST") !== "0";
}

async function resolveLinearToken(accountHint?: string): Promise<string | null> {
  const accounts = await listLinearOAuthAccounts();
  const match = accountHint
    ? accounts.find(
        (a) =>
          a.accountId === accountHint ||
          a.email?.toLowerCase() === accountHint.toLowerCase() ||
          a.organizationName?.toLowerCase() === accountHint.toLowerCase()
      )
    : accounts[0];
  return getLinearAccessToken(match?.accountId ?? accounts[0]?.accountId);
}

async function linearGraphql(
  query: string,
  variables: Record<string, unknown> | undefined,
  accountHint?: string
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const token = await resolveLinearToken(accountHint);
  if (!token) {
    return {
      ok: false,
      error:
        "Linear not connected — Settings → Integrations → Connect Linear (hosted sign-in, no .env setup).",
    };
  }
  const res = await fetch(LINEAR_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as {
    data?: unknown;
    errors?: Array<{ message?: string }>;
  };
  if (!res.ok) {
    return { ok: false, error: `Linear HTTP ${res.status}` };
  }
  if (json.errors?.length) {
    return { ok: false, error: json.errors.map((e) => e.message).filter(Boolean).join("; ") };
  }
  return { ok: true, data: json.data };
}

function jsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function registerLinearRestTools(registry: ToolRegistry): void {
  if (!linearRestEnabled()) return;

  registry.register(
    defineTool({
      name: "linear_list_teams",
      description: "WHEN: User needs Linear teams. HOW: Lists teams in the connected workspace.",
      parameters: {
        type: "object",
        properties: { account_hint: { type: "string" } },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const result = await linearGraphql(
          `query { teams { nodes { id key name } } }`,
          undefined,
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_list_issues",
      description:
        "WHEN: User asks for Linear issues, backlog, or sprint items.\n" +
        "HOW: Optional team_id filter; limit default 25.",
      parameters: {
        type: "object",
        properties: {
          team_id: { type: "string", description: "Linear team uuid." },
          limit: { type: "number" },
          account_hint: { type: "string" },
        },
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 20_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(50, Math.max(1, Number(args["limit"]) || 25));
        const teamId = typeof args["team_id"] === "string" ? args["team_id"].trim() : "";
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const result = teamId
          ? await linearGraphql(
              `query($first: Int!, $teamId: ID!) {
                issues(first: $first, filter: { team: { id: { eq: $teamId } } }) {
                  nodes { id identifier title state { name } priority assignee { name } url updatedAt }
                }
              }`,
              { first: limit, teamId },
              hint
            )
          : await linearGraphql(
              `query($first: Int!) {
                issues(first: $first) {
                  nodes { id identifier title state { name } priority assignee { name } url updatedAt }
                }
              }`,
              { first: limit },
              hint
            );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_get_issue",
      description: "WHEN: User references a Linear issue by id (uuid) or identifier (e.g. ENG-42).",
      parameters: {
        type: "object",
        properties: {
          issue: { type: "string", description: "Issue uuid or identifier like TEAM-123." },
          account_hint: { type: "string" },
        },
        required: ["issue"],
        additionalProperties: false,
      },
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 15_000,
      handler: async (args): Promise<ToolResult> => {
        const issue = String(args["issue"] ?? "").trim();
        if (!issue) return { ok: false, error: "issue is required" };
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const idMatch = issue.match(/^([A-Za-z]+)-(\d+)$/);
        const result = idMatch
          ? await linearGraphql(
              `query($teamKey: String!, $number: Float!) {
                issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }, first: 1) {
                  nodes { id identifier title description state { name } priority assignee { name } url }
                }
              }`,
              { teamKey: idMatch[1]!.toUpperCase(), number: Number(idMatch[2]) },
              hint
            )
          : await linearGraphql(
              `query($id: String!) {
                issue(id: $id) {
                  id identifier title description state { name } priority assignee { name } url
                }
              }`,
              { id: issue },
              hint
            );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_create_issue",
      description:
        "WHEN: User wants a new Linear issue.\n" +
        "HOW: team_id (uuid) + title; optional description. Approval required.",
      parameters: {
        type: "object",
        properties: {
          team_id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          account_hint: { type: "string" },
        },
        required: ["team_id", "title"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const teamId = String(args["team_id"] ?? "").trim();
        const title = String(args["title"] ?? "").trim();
        if (!teamId || !title) return { ok: false, error: "team_id and title are required" };
        const description = typeof args["description"] === "string" ? args["description"] : "";
        const result = await linearGraphql(
          `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }`,
          { input: { teamId, title, description: description || undefined } },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_add_comment",
      description: "WHEN: User wants to comment on a Linear issue. HOW: issue_id (uuid) + body. Approval required.",
      parameters: {
        type: "object",
        properties: {
          issue_id: { type: "string" },
          body: { type: "string" },
          account_hint: { type: "string" },
        },
        required: ["issue_id", "body"],
        additionalProperties: false,
      },
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const issueId = String(args["issue_id"] ?? "").trim();
        const body = String(args["body"] ?? "").trim();
        if (!issueId || !body) return { ok: false, error: "issue_id and body are required" };
        const result = await linearGraphql(
          `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id body url } } }`,
          { input: { issueId, body } },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );
}
