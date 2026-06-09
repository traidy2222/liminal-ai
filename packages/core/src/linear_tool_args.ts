/** Model-friendly arg normalization for linear_* tools (runs before JSON-schema validation). */

function firstString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function teamKeyOrId(args: Record<string, unknown>, out: Record<string, unknown>): void {
  const team = firstString(args, ["team_id", "team_key", "team"]);
  if (!team) return;
  if (team.length <= 8 && !team.includes("-") && !team.startsWith("linear")) {
    out.team_key = team.toUpperCase();
  } else {
    out.team_id = team;
  }
}

/** Linear issue uuid or identifier like ENG-42. */
export function linearIssueRef(args: Record<string, unknown>): string | undefined {
  return firstString(args, ["issue", "issue_id", "identifier", "id"]);
}

export function normalizeLinearRestToolArgs(
  name: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (!name.startsWith("linear_")) return args;

  const out = { ...args };

  const issueRef = linearIssueRef(out);
  if (issueRef) {
    out.issue = issueRef;
    if (!out.issue_id) out.issue_id = issueRef;
  }

  const parentRef = firstString(out, ["parent_issue", "parent_id", "parent"]);
  if (parentRef) {
    out.parent_issue = parentRef;
    if (!out.parent_id) out.parent_id = parentRef;
  }

  const projectRef = firstString(out, ["project_id", "project"]);
  if (projectRef) {
    if (!out.project_id) out.project_id = projectRef;
    if (!out.project) out.project = projectRef;
  }

  const cycleRef = firstString(out, ["cycle_id", "cycle", "cycle_name", "sprint"]);
  if (cycleRef) {
    if (!out.cycle) out.cycle = cycleRef;
    if (cycleRef.length > 16 && !out.cycle_id) out.cycle_id = cycleRef;
  }

  if (name === "linear_assign_issue" || name === "linear_set_issue_cycle" || name === "linear_link_sub_issue") {
    const assignee = firstString(out, ["assignee_id", "assignee", "user_id"]);
    if (assignee) out.assignee_id = assignee;
    const email = firstString(out, ["assignee_email", "email"]);
    if (email) out.assignee_email = email;
    const nameHint = firstString(out, ["assignee_name", "user_name", "name"]);
    if (nameHint && !out.assignee_email && name !== "linear_link_sub_issue") out.assignee_name = nameHint;
  }

  if (name === "linear_update_issue" || name === "linear_create_issue") {
    const state = firstString(out, ["state_id", "state", "status_id"]);
    if (state) out.state_id = state;
    const stateName = firstString(out, ["state_name", "status", "status_name"]);
    if (stateName) out.state_name = stateName;
    teamKeyOrId(out, out);
    const due = firstString(out, ["due_date", "due", "due_at"]);
    if (due) out.due_date = due;
  }

  if (name === "linear_create_issue" || name === "linear_update_issue") {
    if (typeof out["priority"] === "string" && out["priority"].trim()) {
      const p = Number(out["priority"]);
      if (Number.isFinite(p)) out.priority = p;
    }
  }

  if (name === "linear_create_issue") {
    const team = firstString(out, ["team_id", "team_key", "team"]);
    if (team) {
      if (team.length <= 8 && !team.includes("-")) out.team_key = team.toUpperCase();
      else out.team_id = team;
    }
    const assignee = firstString(out, ["assignee_id", "assignee"]);
    if (assignee) out.assignee_id = assignee;
    const email = firstString(out, ["assignee_email", "email"]);
    if (email) out.assignee_email = email;
    const labels = firstString(out, ["labels", "label"]);
    if (labels && !out.label_names) {
      out.label_names = labels.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  if (
    name === "linear_list_issues" ||
    name === "linear_search_issues" ||
    name === "linear_list_my_issues"
  ) {
    teamKeyOrId(out, out);
    const stateName = firstString(out, ["state_name", "status", "status_name"]);
    if (stateName) out.state_name = stateName;
    const assigneeEmail = firstString(out, ["assignee_email", "email"]);
    if (assigneeEmail) out.assignee_email = assigneeEmail;
    if (out.query === undefined) {
      const q = firstString(out, ["q", "search", "term", "text"]);
      if (q) out.query = q;
    }
  }

  if (
    name === "linear_list_workflow_states" ||
    name === "linear_list_labels" ||
    name === "linear_list_cycles" ||
    name === "linear_list_team_members" ||
    name === "linear_create_label"
  ) {
    teamKeyOrId(out, out);
  }

  if (
    name === "linear_set_issue_labels" ||
    name === "linear_add_issue_labels"
  ) {
    teamKeyOrId(out, out);
    const labels = firstString(out, ["labels", "label"]);
    if (labels && !out.label_names) {
      out.label_names = labels.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  if (name === "linear_update_project" || name === "linear_create_project") {
    const project = firstString(out, ["project_id", "project"]);
    if (project && name === "linear_update_project") {
      out.project_id = project;
    }
    const target = firstString(out, ["target_date", "target", "due_date"]);
    if (target) out.target_date = target;
  }

  if (name === "linear_attach_url") {
    const link = firstString(out, ["url", "link", "href"]);
    if (link) out.url = link;
  }

  if (name === "linear_add_comment") {
    const body = firstString(out, ["body", "comment", "text"]);
    if (body) out.body = body;
  }

  return out;
}

/** Semantic required-field checks after alias normalization (JSON schema uses loose required). */
export function validateLinearToolArgs(
  name: string,
  args: Record<string, unknown>
): string | null {
  const issueTools = new Set([
    "linear_get_issue",
    "linear_list_comments",
    "linear_archive_issue",
    "linear_delete_issue",
    "linear_set_issue_labels",
    "linear_add_issue_labels",
    "linear_set_issue_cycle",
    "linear_link_sub_issue",
    "linear_attach_url",
  ]);
  if (issueTools.has(name) && !linearIssueRef(args)) {
    return 'Missing issue reference — pass issue, issue_id, or identifier (e.g. "VIP-1")';
  }
  if (
    (name === "linear_update_issue" || name === "linear_assign_issue") &&
    !linearIssueRef(args)
  ) {
    return 'Missing issue reference — pass issue or issue_id';
  }
  if (name === "linear_create_issue") {
    if (!firstString(args, ["title"])) return "title is required";
    if (!firstString(args, ["team_id", "team_key", "team"])) {
      return "team_id or team_key is required (use linear_list_teams for keys)";
    }
  }
  if (name === "linear_search_issues" && !firstString(args, ["query", "q", "search", "term"])) {
    return "query (search text) is required";
  }
  if (name === "linear_add_comment" && !firstString(args, ["body", "comment", "text"])) {
    return "body is required";
  }
  if (name === "linear_attach_url" && !firstString(args, ["url", "link", "href"])) {
    return "url is required";
  }
  if (name === "linear_list_team_members" && !firstString(args, ["team_id", "team_key", "team"])) {
    return "team_id or team_key is required";
  }
  if (name === "linear_create_label") {
    if (!firstString(args, ["name"])) return "name is required";
    if (!firstString(args, ["team_id", "team_key", "team"])) return "team_id or team_key is required";
  }
  return null;
}
