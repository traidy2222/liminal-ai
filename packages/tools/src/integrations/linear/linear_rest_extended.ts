/**
 * Extended Linear GraphQL tools — labels, cycles, projects, archive, attachments, viewer.
 */
import type { ToolRegistry, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { LINEAR_SCHEMAS } from "./linear_schema.js";
import {
  resolveLinearCycleId,
  resolveLinearIssueId,
  resolveLinearLabelIds,
  resolveLinearProjectId,
  resolveLinearTeamId,
  type LinearGraphqlFn,
} from "./linear_resolve.js";

export type LinearRestDeps = {
  linearGraphql: (
    query: string,
    variables: Record<string, unknown> | undefined,
    accountHint?: string
  ) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
  linearGql: LinearGraphqlFn;
  jsonOutput: (data: unknown) => string;
};

const ISSUE_DETAIL_FIELDS = `
  id identifier title description
  state { id name type }
  priority estimate dueDate
  assignee { id name email }
  team { id key name }
  project { id name state }
  cycle { id name number startsAt endsAt }
  parent { id identifier title }
  children(first: 15) { nodes { id identifier title state { name } url } }
  labels { nodes { id name color } }
  url createdAt updatedAt
`;

function hint(args: Record<string, unknown>): string | undefined {
  return typeof args["account_hint"] === "string" ? args["account_hint"] : undefined;
}

function limit(args: Record<string, unknown>, fallback: number, max = 50): number {
  return Math.min(max, Math.max(1, Number(args["limit"]) || fallback));
}

async function resolveIssueRef(
  deps: LinearRestDeps,
  args: Record<string, unknown>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const issueRef = String(args["issue"] ?? args["issue_id"] ?? "").trim();
  if (!issueRef) return { ok: false, error: "issue is required" };
  return resolveLinearIssueId(deps.linearGql, issueRef, hint(args));
}

export function registerLinearRestExtendedTools(registry: ToolRegistry, deps: LinearRestDeps): void {
  const { linearGraphql, linearGql, jsonOutput } = deps;

  registry.register(
    defineTool({
      name: "linear_get_viewer",
      description:
        "WHEN: Agent needs the connected Linear user (id, email) or workspace context.\n" +
        "HOW: Returns viewer profile.",
      parameters: LINEAR_SCHEMAS.getViewer(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const result = await linearGraphql(
          `query {
            viewer {
              id name email displayName active
              organization { id name urlKey }
            }
          }`,
          undefined,
          hint(args)
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_list_my_issues",
      description:
        "WHEN: User asks for their assigned Linear issues or 'my tickets'.\n" +
        "HOW: Lists issues assigned to the connected viewer.",
      parameters: LINEAR_SCHEMAS.listMyIssues(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 20_000,
      handler: async (args): Promise<ToolResult> => {
        const h = hint(args);
        const viewer = await linearGraphql(
          `query { viewer { id } }`,
          undefined,
          h
        );
        if (!viewer.ok) return { ok: false, error: viewer.error };
        const userId = (viewer.data as { viewer?: { id?: string } })?.viewer?.id;
        if (!userId) return { ok: false, error: "Could not resolve Linear viewer" };

        const filter: Record<string, unknown> = { assignee: { id: { eq: userId } } };
        const teamKey = typeof args["team_key"] === "string" ? args["team_key"].trim().toUpperCase() : "";
        if (teamKey) filter.team = { key: { eq: teamKey } };
        const stateName = typeof args["state_name"] === "string" ? args["state_name"].trim() : "";
        if (stateName) filter.state = { name: { eq: stateName } };

        const result = await linearGraphql(
          `query($first: Int!, $filter: IssueFilter!) {
            issues(first: $first, filter: $filter) {
              nodes { id identifier title state { name } priority url updatedAt }
            }
          }`,
          { first: limit(args, 25), filter },
          h
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_list_labels",
      description:
        "WHEN: User needs label names/ids for filtering or labeling issues.\n" +
        "HOW: Optional team_key or team_id filter.",
      parameters: LINEAR_SCHEMAS.listLabels(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 120_000,
      handler: async (args): Promise<ToolResult> => {
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

        const result =
          Object.keys(filter).length > 0
            ? await linearGraphql(
                `query($first: Int!, $filter: IssueLabelFilter!) {
                  issueLabels(filter: $filter, first: $first) {
                    nodes { id name color description team { key } }
                  }
                }`,
                { first: limit(args, 50, 100), filter },
                hint(args)
              )
            : await linearGraphql(
                `query($first: Int!) {
                  issueLabels(first: $first) { nodes { id name color team { key } } }
                }`,
                { first: limit(args, 50, 100) },
                hint(args)
              );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_list_cycles",
      description:
        "WHEN: User asks about sprints/cycles or needs cycle_id for an issue.\n" +
        "HOW: Optional team_key or team_id; lists active and recent cycles.",
      parameters: LINEAR_SCHEMAS.listCycles(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 60_000,
      handler: async (args): Promise<ToolResult> => {
        const filter: Record<string, unknown> = {};
        const teamId = typeof args["team_id"] === "string" ? args["team_id"].trim() : "";
        const teamKey = typeof args["team_key"] === "string" ? args["team_key"].trim().toUpperCase() : "";
        if (teamId) filter.team = { id: { eq: teamId } };
        else if (teamKey) filter.team = { key: { eq: teamKey } };
        if (args["active_only"] === true) filter.isActive = { eq: true };

        const result =
          Object.keys(filter).length > 0
            ? await linearGraphql(
                `query($first: Int!, $filter: CycleFilter!) {
                  cycles(filter: $filter, first: $first) {
                    nodes { id name number startsAt endsAt completedAt team { key name } }
                  }
                }`,
                { first: limit(args, 20), filter },
                hint(args)
              )
            : await linearGraphql(
                `query($first: Int!) {
                  cycles(first: $first) {
                    nodes { id name number startsAt endsAt completedAt team { key name } }
                  }
                }`,
                { first: limit(args, 20) },
                hint(args)
              );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_list_team_members",
      description:
        "WHEN: User needs members of a specific Linear team.\n" +
        "HOW: team_id or team_key (e.g. ENG).",
      parameters: LINEAR_SCHEMAS.listTeamMembers(),
      requiresApproval: false,
      cacheable: true,
      cacheTtlMs: 120_000,
      handler: async (args): Promise<ToolResult> => {
        const h = hint(args);
        const teamRef =
          typeof args["team_id"] === "string"
            ? args["team_id"].trim()
            : typeof args["team_key"] === "string"
              ? args["team_key"].trim()
              : typeof args["team"] === "string"
                ? args["team"].trim()
                : "";
        if (!teamRef) return { ok: false, error: "team_id or team_key is required" };
        const team = await resolveLinearTeamId(linearGql, teamRef, h);
        if (!team.ok) return { ok: false, error: team.error };
        const result = await linearGraphql(
          `query($id: String!) {
            team(id: $id) {
              id key name
              members { nodes { id name email displayName active } }
            }
          }`,
          { id: team.id },
          h
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_archive_issue",
      description:
        "WHEN: User wants to archive (soft-delete) a Linear issue.\n" +
        "HOW: issue uuid or ENG-42. Approval required.",
      parameters: LINEAR_SCHEMAS.issueMutation(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const resolved = await resolveIssueRef(deps, args);
        if (!resolved.ok) return { ok: false, error: resolved.error };
        const result = await linearGraphql(
          `mutation($id: String!) { issueArchive(id: $id) { success } }`,
          { id: resolved.id },
          hint(args)
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_delete_issue",
      description:
        "WHEN: User explicitly wants to permanently delete a Linear issue.\n" +
        "HOW: issue uuid or ENG-42. Prefer linear_archive_issue when unsure. Approval required.",
      parameters: LINEAR_SCHEMAS.issueMutation(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const resolved = await resolveIssueRef(deps, args);
        if (!resolved.ok) return { ok: false, error: resolved.error };
        const result = await linearGraphql(
          `mutation($id: String!) { issueDelete(id: $id) { success } }`,
          { id: resolved.id },
          hint(args)
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_set_issue_labels",
      description:
        "WHEN: User wants to replace all labels on an issue.\n" +
        "HOW: issue + label_names (array) or label_ids. Pass empty label_names to clear. Approval required.",
      parameters: LINEAR_SCHEMAS.setLabels(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const h = hint(args);
        const resolved = await resolveIssueRef(deps, args);
        if (!resolved.ok) return { ok: false, error: resolved.error };

        let labelIds: string[] = [];
        if (Array.isArray(args["label_ids"])) {
          labelIds = args["label_ids"]
            .filter((x): x is string => typeof x === "string" && !!x.trim())
            .map((x) => x.trim());
        } else if (Array.isArray(args["label_names"])) {
          const names = args["label_names"].filter((x): x is string => typeof x === "string");
          if (names.length === 0) {
            labelIds = [];
          } else {
            const labels = await resolveLinearLabelIds(
              linearGql,
              names,
              { teamKey: typeof args["team_key"] === "string" ? args["team_key"] : undefined },
              h
            );
            if (!labels.ok) return { ok: false, error: labels.error };
            labelIds = labels.ids;
          }
        } else {
          return { ok: false, error: "label_names or label_ids is required" };
        }

        const result = await linearGraphql(
          `mutation($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success issue { id identifier labels { nodes { id name } } url }
            }
          }`,
          { id: resolved.id, input: { labelIds } },
          h
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_add_issue_labels",
      description:
        "WHEN: User wants to add labels without removing existing ones.\n" +
        "HOW: issue + label_names or label_ids. Approval required.",
      parameters: LINEAR_SCHEMAS.setLabels(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const h = hint(args);
        const resolved = await resolveIssueRef(deps, args);
        if (!resolved.ok) return { ok: false, error: resolved.error };

        const current = await linearGraphql(
          `query($id: String!) { issue(id: $id) { labels { nodes { id } } } }`,
          { id: resolved.id },
          h
        );
        if (!current.ok) return { ok: false, error: current.error };
        const existing =
          (current.data as { issue?: { labels?: { nodes?: Array<{ id?: string }> } } })?.issue?.labels?.nodes
            ?.map((n) => n.id)
            .filter((id): id is string => Boolean(id)) ?? [];

        let addIds: string[] = [];
        if (Array.isArray(args["label_ids"])) {
          addIds = args["label_ids"]
            .filter((x): x is string => typeof x === "string" && !!x.trim())
            .map((x) => x.trim());
        } else if (Array.isArray(args["label_names"])) {
          const names = args["label_names"].filter((x): x is string => typeof x === "string");
          if (names.length === 0) return { ok: false, error: "label_names is required" };
          const labels = await resolveLinearLabelIds(
            linearGql,
            names,
            { teamKey: typeof args["team_key"] === "string" ? args["team_key"] : undefined },
            h
          );
          if (!labels.ok) return { ok: false, error: labels.error };
          addIds = labels.ids;
        } else {
          return { ok: false, error: "label_names or label_ids is required" };
        }

        const merged = [...new Set([...existing, ...addIds])];
        const result = await linearGraphql(
          `mutation($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success issue { id identifier labels { nodes { id name } } url }
            }
          }`,
          { id: resolved.id, input: { labelIds: merged } },
          h
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_create_label",
      description:
        "WHEN: User needs a new label on a team before applying it to issues.\n" +
        "HOW: team_id or team_key + name. Approval required.",
      parameters: LINEAR_SCHEMAS.createLabel(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const h = hint(args);
        const labelName = String(args["name"] ?? "").trim();
        if (!labelName) return { ok: false, error: "name is required" };
        const teamRef =
          typeof args["team_id"] === "string"
            ? args["team_id"].trim()
            : typeof args["team_key"] === "string"
              ? args["team_key"].trim()
              : typeof args["team"] === "string"
                ? args["team"].trim()
                : "";
        if (!teamRef) return { ok: false, error: "team_id or team_key is required" };
        const team = await resolveLinearTeamId(linearGql, teamRef, h);
        if (!team.ok) return { ok: false, error: team.error };
        const input: Record<string, unknown> = { teamId: team.id, name: labelName };
        if (typeof args["color"] === "string" && args["color"].trim()) input.color = args["color"].trim();
        if (typeof args["description"] === "string" && args["description"].trim()) {
          input.description = args["description"].trim();
        }
        const result = await linearGraphql(
          `mutation($input: IssueLabelCreateInput!) {
            issueLabelCreate(input: $input) { success issueLabel { id name color team { key } } }
          }`,
          { input },
          h
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_create_project",
      description:
        "WHEN: User wants a new Linear project.\n" +
        "HOW: name + team_ids or team_keys (array). Approval required.",
      parameters: LINEAR_SCHEMAS.createProject(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const h = hint(args);
        const name = String(args["name"] ?? "").trim();
        if (!name) return { ok: false, error: "name is required" };

        const teamIds: string[] = [];
        if (Array.isArray(args["team_ids"])) {
          for (const id of args["team_ids"]) {
            if (typeof id === "string" && id.trim()) teamIds.push(id.trim());
          }
        }
        const keys: string[] = Array.isArray(args["team_keys"])
          ? args["team_keys"].filter((k): k is string => typeof k === "string")
          : [];
        if (typeof args["team_key"] === "string" && args["team_key"].trim()) {
          keys.push(args["team_key"].trim());
        }
        if (typeof args["team_id"] === "string" && args["team_id"].trim()) {
          teamIds.push(args["team_id"].trim());
        }
        for (const key of keys) {
          const team = await resolveLinearTeamId(linearGql, key, h);
          if (!team.ok) return { ok: false, error: team.error };
          teamIds.push(team.id);
        }
        const uniqueTeamIds = [...new Set(teamIds)];
        if (uniqueTeamIds.length === 0) {
          return { ok: false, error: "team_id, team_key, team_ids, or team_keys is required" };
        }

        const input: Record<string, unknown> = { name, teamIds: uniqueTeamIds };
        if (typeof args["description"] === "string" && args["description"].trim()) {
          input.description = args["description"].trim();
        }
        if (typeof args["target_date"] === "string" && args["target_date"].trim()) {
          input.targetDate = args["target_date"].trim();
        }

        const result = await linearGraphql(
          `mutation($input: ProjectCreateInput!) {
            projectCreate(input: $input) { success project { id name url state } }
          }`,
          { input },
          h
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_update_project",
      description:
        "WHEN: User wants to rename or update a Linear project.\n" +
        "HOW: project_id or project name + fields to patch. Approval required.",
      parameters: LINEAR_SCHEMAS.updateProject(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const h = hint(args);
        const projectRef = String(args["project_id"] ?? args["project"] ?? "").trim();
        if (!projectRef) return { ok: false, error: "project_id is required" };
        const project = await resolveLinearProjectId(linearGql, projectRef, h);
        if (!project.ok) return { ok: false, error: project.error };

        const input: Record<string, unknown> = {};
        if (typeof args["name"] === "string" && args["name"].trim()) input.name = args["name"].trim();
        if (typeof args["description"] === "string") input.description = args["description"];
        if (typeof args["state"] === "string" && args["state"].trim()) input.state = args["state"].trim();
        if (typeof args["target_date"] === "string" && args["target_date"].trim()) {
          input.targetDate = args["target_date"].trim();
        }
        if (Object.keys(input).length === 0) {
          return { ok: false, error: "provide at least one of name, description, state, target_date" };
        }

        const result = await linearGraphql(
          `mutation($id: String!, $input: ProjectUpdateInput!) {
            projectUpdate(id: $id, input: $input) { success project { id name state url targetDate } }
          }`,
          { id: project.id, input },
          h
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_set_issue_cycle",
      description:
        "WHEN: User wants to add an issue to a sprint/cycle.\n" +
        "HOW: issue + cycle_id, cycle number, or cycle_name. Pass empty cycle_id to remove from cycle. Approval required.",
      parameters: LINEAR_SCHEMAS.setCycle(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const h = hint(args);
        const resolved = await resolveIssueRef(deps, args);
        if (!resolved.ok) return { ok: false, error: resolved.error };

        let cycleId: string | null = null;
        if (typeof args["cycle_id"] === "string") {
          cycleId = args["cycle_id"].trim() || null;
        } else {
          const cycleRef =
            typeof args["cycle"] === "string"
              ? args["cycle"].trim()
              : typeof args["cycle_name"] === "string"
                ? args["cycle_name"].trim()
                : "";
          if (!cycleRef) return { ok: false, error: "cycle_id or cycle is required" };
          const cycle = await resolveLinearCycleId(
            linearGql,
            cycleRef,
            { teamKey: typeof args["team_key"] === "string" ? args["team_key"] : undefined },
            h
          );
          if (!cycle.ok) return { ok: false, error: cycle.error };
          cycleId = cycle.id;
        }

        const result = await linearGraphql(
          `mutation($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success issue { id identifier cycle { id name number } url }
            }
          }`,
          { id: resolved.id, input: { cycleId } },
          h
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_link_sub_issue",
      description:
        "WHEN: User wants to set a parent issue (sub-task relationship).\n" +
        "HOW: child issue + parent_issue (uuid or ENG-1). Pass empty parent_issue to unlink. Approval required.",
      parameters: LINEAR_SCHEMAS.linkSubIssue(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const h = hint(args);
        const resolved = await resolveIssueRef(deps, args);
        if (!resolved.ok) return { ok: false, error: resolved.error };

        const parentRef = String(args["parent_issue"] ?? args["parent_id"] ?? "").trim();
        let parentId: string | null = null;
        if (parentRef) {
          const parent = await resolveLinearIssueId(linearGql, parentRef, h);
          if (!parent.ok) return { ok: false, error: parent.error };
          parentId = parent.id;
        }

        const result = await linearGraphql(
          `mutation($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success issue { id identifier parent { id identifier title } url }
            }
          }`,
          { id: resolved.id, input: { parentId } },
          h
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );

  registry.register(
    defineTool({
      name: "linear_attach_url",
      description:
        "WHEN: User wants to link an external URL to a Linear issue.\n" +
        "HOW: issue + url; optional title. Approval required.",
      parameters: LINEAR_SCHEMAS.attachUrl(),
      requiresApproval: true,
      handler: async (args): Promise<ToolResult> => {
        const h = hint(args);
        const resolved = await resolveIssueRef(deps, args);
        if (!resolved.ok) return { ok: false, error: resolved.error };
        const url = String(args["url"] ?? "").trim();
        if (!url) return { ok: false, error: "url is required" };
        const input: Record<string, unknown> = { issueId: resolved.id, url };
        if (typeof args["title"] === "string" && args["title"].trim()) input.title = args["title"].trim();

        const result = await linearGraphql(
          `mutation($input: AttachmentCreateInput!) {
            attachmentCreate(input: $input) { success attachment { id title url } }
          }`,
          { input },
          h
        );
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: jsonOutput(result.data) };
      },
    })
  );
}

/** Rich issue detail query used by linear_get_issue. */
export const LINEAR_ISSUE_DETAIL_FIELDS = ISSUE_DETAIL_FIELDS;
