/**
 * Linear tool JSON schemas — include every alias models use so validation passes
 * after normalizeLinearRestToolArgs maps them to canonical handler fields.
 */
import type { PropertySchema, ToolParameterSchema } from "@liminal/core";

export const LINEAR_ACCOUNT_HINT: PropertySchema = {
  type: "string",
  description: "Optional OAuth account hint (email or org name).",
};

export const LINEAR_LIMIT: PropertySchema = {
  type: "number",
  description: "Max results (default varies by tool).",
};

/** Accept issue, issue_id, identifier, or id — all mean the same Linear issue ref. */
export const LINEAR_ISSUE_REF: Record<string, PropertySchema> = {
  issue: {
    type: "string",
    description: "Issue uuid or identifier (e.g. ENG-42).",
  },
  issue_id: { type: "string", description: "Alias for issue." },
  identifier: { type: "string", description: "Alias for issue (TEAM-123)." },
  id: { type: "string", description: "Alias for issue uuid." },
};

export const LINEAR_TEAM_REF: Record<string, PropertySchema> = {
  team_id: { type: "string", description: "Team uuid." },
  team_key: { type: "string", description: "Team key (e.g. ENG, VIP)." },
  team: { type: "string", description: "Alias for team_key or team_id." },
};

export const LINEAR_STATE_REF: Record<string, PropertySchema> = {
  state_id: { type: "string", description: "Workflow state uuid." },
  state_name: { type: "string", description: "Workflow state name (Done, In Progress, …)." },
  state: { type: "string", description: "Alias for state_id or state_name." },
  status: { type: "string", description: "Alias for state_name." },
  status_name: { type: "string", description: "Alias for state_name." },
};

export const LINEAR_ASSIGNEE_REF: Record<string, PropertySchema> = {
  assignee_id: { type: "string", description: "User uuid; empty string unassigns." },
  assignee_email: { type: "string", description: "Assignee email." },
  assignee_name: { type: "string", description: "Assignee display name." },
  assignee: { type: "string", description: "Alias for assignee_id." },
  email: { type: "string", description: "Alias for assignee_email." },
  user_id: { type: "string", description: "Alias for assignee_id." },
  user_name: { type: "string", description: "Alias for assignee_name." },
  name: { type: "string", description: "Alias for assignee_name when assigning." },
};

export const LINEAR_PRIORITY: PropertySchema = {
  type: "number",
  description: "Priority: 0=none, 1=urgent, 2=high, 3=medium, 4=low (Linear IssueCreateInput).",
};

export const LINEAR_PROJECT_REF: Record<string, PropertySchema> = {
  project_id: { type: "string", description: "Project uuid." },
  project: { type: "string", description: "Project name or uuid." },
};

export const LINEAR_PARENT_REF: Record<string, PropertySchema> = {
  parent_issue: { type: "string", description: "Parent issue uuid or ENG-1." },
  parent_id: { type: "string", description: "Alias for parent_issue." },
  parent: { type: "string", description: "Alias for parent_issue." },
};

export const LINEAR_CYCLE_REF: Record<string, PropertySchema> = {
  cycle_id: { type: "string", description: "Cycle uuid; empty removes from cycle." },
  cycle: { type: "string", description: "Cycle number or name." },
  cycle_name: { type: "string", description: "Alias for cycle." },
  sprint: { type: "string", description: "Alias for cycle." },
};

export const LINEAR_LABEL_REF: Record<string, PropertySchema> = {
  label_ids: { type: "array", items: { type: "string" }, description: "Label uuids." },
  label_names: { type: "array", items: { type: "string" }, description: "Label names." },
  labels: { type: "string", description: "Comma-separated label names." },
  label: { type: "string", description: "Single label name." },
};

export const LINEAR_SEARCH_REF: Record<string, PropertySchema> = {
  query: { type: "string", description: "Search text." },
  q: { type: "string", description: "Alias for query." },
  search: { type: "string", description: "Alias for query." },
  term: { type: "string", description: "Alias for query." },
  text: { type: "string", description: "Alias for query." },
};

export const LINEAR_DUE_DATE: PropertySchema = {
  type: "string",
  description: "Due date (ISO date / TimelessDate).",
};

function schema(
  properties: Record<string, PropertySchema>,
  opts?: { required?: string[]; description?: string }
): ToolParameterSchema {
  return {
    type: "object",
    properties,
    required: opts?.required,
    additionalProperties: false,
  };
}

export const LINEAR_SCHEMAS = {
  getViewer: () =>
    schema({ account_hint: LINEAR_ACCOUNT_HINT }),

  listTeams: () =>
    schema({ account_hint: LINEAR_ACCOUNT_HINT }),

  listIssues: () =>
    schema({
      ...LINEAR_TEAM_REF,
      ...LINEAR_STATE_REF,
      assignee_email: LINEAR_ASSIGNEE_REF.assignee_email!,
      email: LINEAR_ASSIGNEE_REF.email!,
      limit: LINEAR_LIMIT,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  listMyIssues: () =>
    schema({
      team_key: LINEAR_TEAM_REF.team_key!,
      team_id: LINEAR_TEAM_REF.team_id!,
      team: LINEAR_TEAM_REF.team!,
      state_name: LINEAR_STATE_REF.state_name!,
      status: LINEAR_STATE_REF.status!,
      limit: LINEAR_LIMIT,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  getIssue: () =>
    schema({
      ...LINEAR_ISSUE_REF,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  createIssue: () =>
    schema(
      {
        ...LINEAR_TEAM_REF,
        title: { type: "string", description: "Issue title (required)." },
        description: { type: "string" },
        priority: LINEAR_PRIORITY,
        estimate: { type: "number", description: "Story points." },
        due_date: LINEAR_DUE_DATE,
        due: { type: "string", description: "Alias for due_date." },
        ...LINEAR_PROJECT_REF,
        ...LINEAR_PARENT_REF,
        ...LINEAR_CYCLE_REF,
        ...LINEAR_LABEL_REF,
        ...LINEAR_STATE_REF,
        ...LINEAR_ASSIGNEE_REF,
        account_hint: LINEAR_ACCOUNT_HINT,
      },
      { required: ["title"] }
    ),

  updateIssue: () =>
    schema(
      {
        ...LINEAR_ISSUE_REF,
        title: { type: "string" },
        description: { type: "string" },
        ...LINEAR_STATE_REF,
        team_key: LINEAR_TEAM_REF.team_key!,
        priority: LINEAR_PRIORITY,
        estimate: { type: "number" },
        due_date: LINEAR_DUE_DATE,
        due: { type: "string" },
        ...LINEAR_PROJECT_REF,
        ...LINEAR_CYCLE_REF,
        ...LINEAR_PARENT_REF,
        ...LINEAR_LABEL_REF,
        account_hint: LINEAR_ACCOUNT_HINT,
      },
      { required: [] }
    ),

  assignIssue: () =>
    schema({
      ...LINEAR_ISSUE_REF,
      ...LINEAR_ASSIGNEE_REF,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  addComment: () =>
    schema(
      {
        ...LINEAR_ISSUE_REF,
        body: { type: "string", description: "Comment markdown." },
        comment: { type: "string", description: "Alias for body." },
        text: { type: "string", description: "Alias for body." },
        account_hint: LINEAR_ACCOUNT_HINT,
      },
      { required: ["body"] }
    ),

  listProjects: () =>
    schema({
      ...LINEAR_TEAM_REF,
      limit: LINEAR_LIMIT,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  listComments: () =>
    schema({
      ...LINEAR_ISSUE_REF,
      limit: LINEAR_LIMIT,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  searchIssues: () =>
    schema({
      ...LINEAR_SEARCH_REF,
      ...LINEAR_TEAM_REF,
      limit: LINEAR_LIMIT,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  listUsers: () =>
    schema({ limit: LINEAR_LIMIT, account_hint: LINEAR_ACCOUNT_HINT }),

  listWorkflowStates: () =>
    schema({
      ...LINEAR_TEAM_REF,
      limit: LINEAR_LIMIT,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  issueMutation: () =>
    schema({
      ...LINEAR_ISSUE_REF,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  setLabels: () =>
    schema({
      ...LINEAR_ISSUE_REF,
      ...LINEAR_LABEL_REF,
      team_key: LINEAR_TEAM_REF.team_key!,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  setCycle: () =>
    schema({
      ...LINEAR_ISSUE_REF,
      ...LINEAR_CYCLE_REF,
      team_key: LINEAR_TEAM_REF.team_key!,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  linkSubIssue: () =>
    schema({
      ...LINEAR_ISSUE_REF,
      ...LINEAR_PARENT_REF,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  attachUrl: () =>
    schema({
      ...LINEAR_ISSUE_REF,
      url: { type: "string", description: "External URL to attach." },
      link: { type: "string", description: "Alias for url." },
      href: { type: "string", description: "Alias for url." },
      title: { type: "string" },
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  createLabel: () =>
    schema(
      {
        ...LINEAR_TEAM_REF,
        name: { type: "string" },
        color: { type: "string" },
        description: { type: "string" },
        account_hint: LINEAR_ACCOUNT_HINT,
      },
      { required: ["name"] }
    ),

  createProject: () =>
    schema(
      {
        name: { type: "string" },
        description: { type: "string" },
        team_ids: { type: "array", items: { type: "string" } },
        team_keys: { type: "array", items: { type: "string" } },
        team_id: LINEAR_TEAM_REF.team_id!,
        team_key: LINEAR_TEAM_REF.team_key!,
        target_date: { type: "string" },
        target: { type: "string", description: "Alias for target_date." },
        account_hint: LINEAR_ACCOUNT_HINT,
      },
      { required: ["name"] }
    ),

  updateProject: () =>
    schema({
      ...LINEAR_PROJECT_REF,
      name: { type: "string" },
      description: { type: "string" },
      state: { type: "string", description: "planned, started, paused, completed, canceled." },
      target_date: { type: "string" },
      target: { type: "string" },
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  listLabels: () =>
    schema({ ...LINEAR_TEAM_REF, limit: LINEAR_LIMIT, account_hint: LINEAR_ACCOUNT_HINT }),

  listCycles: () =>
    schema({
      ...LINEAR_TEAM_REF,
      active_only: { type: "boolean" },
      limit: LINEAR_LIMIT,
      account_hint: LINEAR_ACCOUNT_HINT,
    }),

  listTeamMembers: () =>
    schema({ ...LINEAR_TEAM_REF, account_hint: LINEAR_ACCOUNT_HINT }),
} as const;
