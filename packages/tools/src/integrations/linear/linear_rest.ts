/**
 * Linear GraphQL REST tools (OAuth).
 */
import type { ToolRegistry, ToolResult } from "@liminal/core";
import { effectiveHarnessEnvRaw, getLinearAccessToken, listLinearOAuthAccounts } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { integrationNotConnectedError } from "../core/integration_oauth_start.js";
import {
  linearSearchIssues,
  resolveLinearCycleId,
  resolveLinearIssueId,
  resolveLinearLabelIds,
  resolveLinearProjectId,
  resolveLinearTeamId,
  resolveLinearUserId,
  resolveLinearWorkflowStateId,
  type LinearGraphqlFn,
} from "./linear_resolve.js";
import {
  LINEAR_ISSUE_DETAIL_FIELDS,
  registerLinearRestExtendedTools,
} from "./linear_rest_extended.js";
import { LINEAR_SCHEMAS } from "./linear_schema.js";

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
      error: integrationNotConnectedError("linear"),
    };
  }
  const auth = token.trim().startsWith("Bearer ") ? token.trim() : `Bearer ${token.trim()}`;
  const res = await fetch(LINEAR_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as {
    data?: unknown;
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) {
    return { ok: false, error: json.errors.map((e) => e.message).filter(Boolean).join("; ") };
  }
  if (!res.ok) {
    return { ok: false, error: `Linear HTTP ${res.status}` };
  }
  return { ok: true, data: json.data };
}

function jsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

const linearGql: LinearGraphqlFn = (query, variables, accountHint) =>
  linearGraphql(query, variables, accountHint);

function buildIssueListFilter(args: Record<string, unknown>): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};
  const teamId = typeof args["team_id"] === "string" ? args["team_id"].trim() : "";
  const teamKey = typeof args["team_key"] === "string" ? args["team_key"].trim().toUpperCase() : "";
  if (teamId) filter.team = { id: { eq: teamId } };
  else if (teamKey) filter.team = { key: { eq: teamKey } };
  const stateName = typeof args["state_name"] === "string" ? args["state_name"].trim() : "";
  if (stateName) filter.state = { name: { eq: stateName } };
  const assigneeEmail =
    typeof args["assignee_email"] === "string" ? args["assignee_email"].trim().toLowerCase() : "";
  if (assigneeEmail) filter.assignee = { email: { eq: assigneeEmail } };
  return Object.keys(filter).length > 0 ? filter : undefined;
}

export function registerLinearRestTools(registry: ToolRegistry): void {
  if (!linearRestEnabled()) return;

  registry.register(
    defineTool({
      name: "linear_list_teams",
      description:
        "WHEN: User needs Linear teams.\n" +
        "HOW: Returns team id, key (e.g. VIP), and name. Use key for team_key on create/list filters.",
      parameters: LINEAR_SCHEMAS.listTeams(),
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
      parameters: LINEAR_SCHEMAS.listIssues(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 20_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(50, Math.max(1, Number(args["limit"]) || 25));
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const filter = buildIssueListFilter(args);
        const result = filter
          ? await linearGraphql(
              `query($first: Int!, $filter: IssueFilter!) {
                issues(first: $first, filter: $filter) {
                  nodes { id identifier title state { name } priority assignee { name email } url updatedAt }
                }
              }`,
              { first: limit, filter },
              hint
            )
          : await linearGraphql(
              `query($first: Int!) {
                issues(first: $first) {
                  nodes { id identifier title state { name } priority assignee { name email } url updatedAt }
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
      description:
        "WHEN: User references a Linear issue.\n" +
        "HOW: Pass issue, issue_id, or identifier (e.g. VIP-1, ENG-42). Returns labels, cycle, parent, sub-issues.",
      parameters: LINEAR_SCHEMAS.getIssue(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 15_000,
      handler: async (args): Promise<ToolResult> => {
        const issue = String(args["issue"] ?? args["issue_id"] ?? args["identifier"] ?? "").trim();
        if (!issue) return { ok: false, error: "issue is required" };
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const resolved = await resolveLinearIssueId(linearGql, issue, hint);
        if (!resolved.ok) return { ok: false, error: resolved.error };
        const result = await linearGraphql(
          `query($id: String!) {
            issue(id: $id) { ${LINEAR_ISSUE_DETAIL_FIELDS} }
          }`,
          { id: resolved.id },
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
        "HOW: team_key (from linear_list_teams) + title. Optional: priority (0–4), state_name, assignee_email, labels. Approval required.",
      parameters: LINEAR_SCHEMAS.createIssue(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const title = String(args["title"] ?? "").trim();
        if (!title) return { ok: false, error: "title is required" };
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        let teamId = String(args["team_id"] ?? "").trim();
        if (!teamId) {
          const teamKey = typeof args["team_key"] === "string" ? args["team_key"].trim() : "";
          if (!teamKey) return { ok: false, error: "team_id or team_key is required" };
          const team = await resolveLinearTeamId(linearGql, teamKey, hint);
          if (!team.ok) return { ok: false, error: team.error };
          teamId = team.id;
        }
        const description = typeof args["description"] === "string" ? args["description"] : "";
        const input: Record<string, unknown> = { teamId, title, description: description || undefined };
        if (typeof args["priority"] === "number" && Number.isFinite(args["priority"])) {
          input.priority = args["priority"];
        }
        if (typeof args["estimate"] === "number" && Number.isFinite(args["estimate"])) {
          input.estimate = args["estimate"];
        }
        if (typeof args["due_date"] === "string" && args["due_date"].trim()) {
          input.dueDate = args["due_date"].trim();
        }
        const projectRef =
          typeof args["project_id"] === "string" && args["project_id"].trim()
            ? args["project_id"].trim()
            : typeof args["project"] === "string"
              ? args["project"].trim()
              : "";
        if (projectRef) {
          const project = await resolveLinearProjectId(linearGql, projectRef, hint);
          if (!project.ok) return { ok: false, error: project.error };
          input.projectId = project.id;
        }
        const parentRef = String(args["parent_issue"] ?? args["parent_id"] ?? "").trim();
        if (parentRef) {
          const parent = await resolveLinearIssueId(linearGql, parentRef, hint);
          if (!parent.ok) return { ok: false, error: parent.error };
          input.parentId = parent.id;
        }
        if (typeof args["cycle_id"] === "string" && args["cycle_id"].trim()) {
          input.cycleId = args["cycle_id"].trim();
        } else if (typeof args["cycle"] === "string" && args["cycle"].trim()) {
          const cycle = await resolveLinearCycleId(
            linearGql,
            args["cycle"],
            { teamId, teamKey: typeof args["team_key"] === "string" ? args["team_key"] : undefined },
            hint
          );
          if (!cycle.ok) return { ok: false, error: cycle.error };
          input.cycleId = cycle.id;
        }
        if (Array.isArray(args["label_ids"])) {
          const ids = args["label_ids"]
            .filter((x): x is string => typeof x === "string" && !!x.trim())
            .map((x) => x.trim());
          if (ids.length > 0) input.labelIds = ids;
        } else if (Array.isArray(args["label_names"])) {
          const names = args["label_names"].filter((x): x is string => typeof x === "string");
          if (names.length > 0) {
            const labels = await resolveLinearLabelIds(
              linearGql,
              names,
              { teamId, teamKey: typeof args["team_key"] === "string" ? args["team_key"] : undefined },
              hint
            );
            if (!labels.ok) return { ok: false, error: labels.error };
            input.labelIds = labels.ids;
          }
        }
        if (typeof args["state_id"] === "string" && args["state_id"].trim()) {
          input.stateId = args["state_id"].trim();
        } else if (typeof args["state_name"] === "string" && args["state_name"].trim()) {
          const teamKey = typeof args["team_key"] === "string" ? args["team_key"] : undefined;
          const state = await resolveLinearWorkflowStateId(
            linearGql,
            args["state_name"],
            { teamId, teamKey },
            hint
          );
          if (!state.ok) return { ok: false, error: state.error };
          input.stateId = state.id;
        }
        if (typeof args["assignee_id"] === "string" || typeof args["assignee_email"] === "string") {
          const user = await resolveLinearUserId(
            linearGql,
            {
              assigneeId: typeof args["assignee_id"] === "string" ? args["assignee_id"] : undefined,
              email: typeof args["assignee_email"] === "string" ? args["assignee_email"] : undefined,
            },
            hint
          );
          if (!user.ok) return { ok: false, error: user.error };
          if (user.id) input.assigneeId = user.id;
        }
        const result = await linearGraphql(
          `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }`,
          { input },
          hint
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_add_comment",
      description:
        "WHEN: User wants to comment on a Linear issue.\n" +
        "HOW: issue (uuid or ENG-42) + body. Approval required.",
      parameters: LINEAR_SCHEMAS.addComment(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const issueRef = String(args["issue"] ?? args["issue_id"] ?? "").trim();
        const body = String(args["body"] ?? args["comment"] ?? args["text"] ?? "").trim();
        if (!issueRef || !body) return { ok: false, error: "issue and body are required" };
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const resolved = await resolveLinearIssueId(linearGql, issueRef, hint);
        if (!resolved.ok) return { ok: false, error: resolved.error };
        const result = await linearGraphql(
          `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id body url } } }`,
          { input: { issueId: resolved.id, body } },
          hint
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_list_projects",
      description:
        "WHEN: User needs Linear projects or roadmaps.\n" +
        "HOW: Optional team_id filter; limit default 25.",
      parameters: LINEAR_SCHEMAS.listProjects(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(50, Math.max(1, Number(args["limit"]) || 25));
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        let teamId = typeof args["team_id"] === "string" ? args["team_id"].trim() : "";
        const teamKey = typeof args["team_key"] === "string" ? args["team_key"].trim() : "";
        if (!teamId && teamKey) {
          const team = await resolveLinearTeamId(linearGql, teamKey, hint);
          if (!team.ok) return { ok: false, error: team.error };
          teamId = team.id;
        }
        const filter = teamId ? { accessibleTeams: { id: { eq: teamId } } } : undefined;
        const result = filter
          ? await linearGraphql(
              `query($first: Int!, $filter: ProjectFilter!) {
                projects(first: $first, filter: $filter) {
                  nodes {
                    id name state url targetDate
                    status { name type }
                    teams { nodes { id key name } }
                  }
                }
              }`,
              { first: limit, filter },
              hint
            )
          : await linearGraphql(
              `query($first: Int!) {
                projects(first: $first) {
                  nodes {
                    id name state url targetDate
                    status { name type }
                    teams { nodes { id key name } }
                  }
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
      name: "linear_update_issue",
      description:
        "WHEN: User wants to change a Linear issue (title, description, state, priority).\n" +
        "HOW: issue_id (uuid) + fields to patch. Approval required.",
      parameters: LINEAR_SCHEMAS.updateIssue(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const issueRef = String(args["issue_id"] ?? args["issue"] ?? "").trim();
        if (!issueRef) return { ok: false, error: "issue_id is required" };
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const resolved = await resolveLinearIssueId(linearGql, issueRef, hint);
        if (!resolved.ok) return { ok: false, error: resolved.error };
        const input: Record<string, unknown> = {};
        if (typeof args["title"] === "string" && args["title"].trim()) input.title = args["title"].trim();
        if (typeof args["description"] === "string") input.description = args["description"];
        if (typeof args["state_id"] === "string" && args["state_id"].trim()) {
          input.stateId = args["state_id"].trim();
        } else if (typeof args["state_name"] === "string" && args["state_name"].trim()) {
          const state = await resolveLinearWorkflowStateId(
            linearGql,
            args["state_name"],
            {
              teamKey: typeof args["team_key"] === "string" ? args["team_key"] : undefined,
            },
            hint
          );
          if (!state.ok) return { ok: false, error: state.error };
          input.stateId = state.id;
        }
        if (typeof args["priority"] === "number" && Number.isFinite(args["priority"])) {
          input.priority = args["priority"];
        }
        if (typeof args["estimate"] === "number" && Number.isFinite(args["estimate"])) {
          input.estimate = args["estimate"];
        }
        if (typeof args["due_date"] === "string" && args["due_date"].trim()) {
          input.dueDate = args["due_date"].trim();
        }
        const projectRef =
          typeof args["project_id"] === "string" && args["project_id"].trim()
            ? args["project_id"].trim()
            : typeof args["project"] === "string"
              ? args["project"].trim()
              : "";
        if (projectRef) {
          const project = await resolveLinearProjectId(linearGql, projectRef, hint);
          if (!project.ok) return { ok: false, error: project.error };
          input.projectId = project.id;
        }
        if (typeof args["cycle_id"] === "string" && args["cycle_id"].trim()) {
          input.cycleId = args["cycle_id"].trim();
        } else if (typeof args["cycle"] === "string" && args["cycle"].trim()) {
          const cycle = await resolveLinearCycleId(
            linearGql,
            args["cycle"],
            { teamKey: typeof args["team_key"] === "string" ? args["team_key"] : undefined },
            hint
          );
          if (!cycle.ok) return { ok: false, error: cycle.error };
          input.cycleId = cycle.id;
        }
        const parentRef = String(args["parent_issue"] ?? args["parent_id"] ?? "").trim();
        if (parentRef) {
          const parent = await resolveLinearIssueId(linearGql, parentRef, hint);
          if (!parent.ok) return { ok: false, error: parent.error };
          input.parentId = parent.id;
        }
        if (Array.isArray(args["label_ids"])) {
          input.labelIds = args["label_ids"]
            .filter((x): x is string => typeof x === "string" && !!x.trim())
            .map((x) => x.trim());
        } else if (Array.isArray(args["label_names"])) {
          const names = args["label_names"].filter((x): x is string => typeof x === "string");
          if (names.length > 0) {
            const labels = await resolveLinearLabelIds(
              linearGql,
              names,
              { teamKey: typeof args["team_key"] === "string" ? args["team_key"] : undefined },
              hint
            );
            if (!labels.ok) return { ok: false, error: labels.error };
            input.labelIds = labels.ids;
          }
        }
        if (Object.keys(input).length === 0) {
          return {
            ok: false,
            error:
              "provide at least one field to update (title, description, state, priority, project, cycle, parent, labels, estimate, due_date)",
          };
        }
        const result = await linearGraphql(
          `mutation($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) { success issue { id identifier title state { name } priority url } }
          }`,
          { id: resolved.id, input },
          hint
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_assign_issue",
      description:
        "WHEN: User wants to assign or unassign a Linear issue.\n" +
        "HOW: issue_id (or ENG-42) + assignee_id, assignee_email, or assignee_name. Empty assignee_id unassigns. Approval required.",
      parameters: LINEAR_SCHEMAS.assignIssue(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const issueRef = String(args["issue_id"] ?? args["issue"] ?? "").trim();
        if (!issueRef) return { ok: false, error: "issue_id is required" };
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const resolved = await resolveLinearIssueId(linearGql, issueRef, hint);
        if (!resolved.ok) return { ok: false, error: resolved.error };
        const user = await resolveLinearUserId(
          linearGql,
          {
            assigneeId: typeof args["assignee_id"] === "string" ? args["assignee_id"] : undefined,
            email: typeof args["assignee_email"] === "string" ? args["assignee_email"] : undefined,
            name: typeof args["assignee_name"] === "string" ? args["assignee_name"] : undefined,
          },
          hint
        );
        if (!user.ok) return { ok: false, error: user.error };
        const input = { assigneeId: user.id };
        const result = await linearGraphql(
          `mutation($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) { success issue { id identifier assignee { id name } url } }
          }`,
          { id: resolved.id, input },
          hint
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_list_users",
      description:
        "WHEN: User needs Linear workspace members (for assignee_id lookup).\n" +
        "HOW: Lists users with id, name, email.",
      parameters: LINEAR_SCHEMAS.listUsers(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 120_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(100, Math.max(1, Number(args["limit"]) || 50));
        const result = await linearGraphql(
          `query($first: Int!) {
            users(first: $first) { nodes { id name email active displayName } }
          }`,
          { first: limit },
          typeof args["account_hint"] === "string" ? args["account_hint"] : undefined
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_list_workflow_states",
      description:
        "WHEN: User wants to move issues or needs state_id for linear_update_issue.\n" +
        "HOW: Optional team_key or team_id filter.",
      parameters: LINEAR_SCHEMAS.listWorkflowStates(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 120_000,
      handler: async (args): Promise<ToolResult> => {
        const limit = Math.min(100, Math.max(1, Number(args["limit"]) || 50));
        const filter: Record<string, unknown> = {};
        const teamId = typeof args["team_id"] === "string" ? args["team_id"].trim() : "";
        const teamKey =
          typeof args["team_key"] === "string"
            ? args["team_key"].trim().toUpperCase()
            : typeof args["team"] === "string" && args["team"].length <= 8
              ? args["team"].trim().toUpperCase()
              : "";
        if (teamId) filter.team = { id: { eq: teamId } };
        else if (teamKey) filter.team = { key: { eq: teamKey } };
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const result =
          Object.keys(filter).length > 0
            ? await linearGraphql(
                `query($first: Int!, $filter: WorkflowStateFilter!) {
                  workflowStates(filter: $filter, first: $first) {
                    nodes { id name type color position team { key name } }
                  }
                }`,
                { first: limit, filter },
                hint
              )
            : await linearGraphql(
                `query($first: Int!) {
                  workflowStates(first: $first) {
                    nodes { id name type color position team { key name } }
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
      name: "linear_search_issues",
      description:
        "WHEN: User searches Linear issues by keyword.\n" +
        "HOW: query string (full-text search). Optional team_key filter.",
      parameters: LINEAR_SCHEMAS.searchIssues(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 20_000,
      handler: async (args): Promise<ToolResult> => {
        const term = String(args["query"] ?? args["q"] ?? "").trim();
        if (!term) return { ok: false, error: "query is required" };
        const limit = Math.min(50, Math.max(1, Number(args["limit"]) || 20));
        const teamKey = typeof args["team_key"] === "string" ? args["team_key"].trim().toUpperCase() : "";
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const result = await linearSearchIssues(linearGql, term, {
          first: limit,
          teamKey: teamKey || undefined,
        }, hint);
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_list_comments",
      description:
        "WHEN: User wants discussion on a Linear issue.\n" +
        "HOW: issue uuid or identifier (e.g. ENG-42).",
      parameters: LINEAR_SCHEMAS.listComments(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 15_000,
      handler: async (args): Promise<ToolResult> => {
        const issueRef = String(args["issue"] ?? args["issue_id"] ?? "").trim();
        if (!issueRef) return { ok: false, error: "issue is required" };
        const limit = Math.min(50, Math.max(1, Number(args["limit"]) || 25));
        const hint = typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
        const resolved = await resolveLinearIssueId(linearGql, issueRef, hint);
        if (!resolved.ok) return { ok: false, error: resolved.error };
        const result = await linearGraphql(
          `query($id: String!, $first: Int!) {
            issue(id: $id) {
              identifier
              comments(first: $first) {
                nodes { id body createdAt url user { name email } }
              }
            }
          }`,
          { id: resolved.id, first: limit },
          hint
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registerLinearRestExtendedTools(registry, { linearGraphql, linearGql, jsonOutput });
}
