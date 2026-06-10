/**
 * Resolve Linear human-friendly refs (ENG-42, state names, user emails) to GraphQL ids.
 */

export type LinearGraphqlFn = (
  query: string,
  variables: Record<string, unknown> | undefined,
  accountHint?: string
) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

const IDENTIFIER_RE = /^([A-Za-z]+)-(\d+)$/;

export function parseLinearIdentifier(ref: string): { teamKey: string; number: number } | null {
  const m = ref.trim().match(IDENTIFIER_RE);
  if (!m) return null;
  return { teamKey: m[1]!.toUpperCase(), number: Number(m[2]) };
}

export async function resolveLinearIssueId(
  gql: LinearGraphqlFn,
  ref: string,
  hint?: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const issue = ref.trim();
  if (!issue) return { ok: false, error: "issue reference is required" };

  const parsed = parseLinearIdentifier(issue);
  if (parsed) {
    const result = await gql(
      `query($teamKey: String!, $number: Float!) {
        issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }, first: 1) {
          nodes { id identifier team { id key } }
        }
      }`,
      { teamKey: parsed.teamKey, number: parsed.number },
      hint
    );
    if (!result.ok) return result;
    const nodes = (result.data as { issues?: { nodes?: Array<{ id?: string }> } })?.issues?.nodes ?? [];
    const id = nodes[0]?.id;
    if (!id) return { ok: false, error: `Linear issue not found: ${issue}` };
    return { ok: true, id };
  }

  const byId = await gql(
    `query($id: String!) { issue(id: $id) { id identifier } }`,
    { id: issue },
    hint
  );
  if (!byId.ok) return byId;
  const id = (byId.data as { issue?: { id?: string } })?.issue?.id;
  if (!id) return { ok: false, error: `Linear issue not found: ${issue}` };
  return { ok: true, id };
}

export async function resolveLinearTeamId(
  gql: LinearGraphqlFn,
  ref: string,
  hint?: string
): Promise<{ ok: true; id: string; key?: string } | { ok: false; error: string }> {
  const team = ref.trim();
  if (!team) return { ok: false, error: "team is required" };
  if (team.length > 12 || team.includes("-")) {
    const byId = await gql(`query($id: String!) { team(id: $id) { id key } }`, { id: team }, hint);
    if (!byId.ok) return byId;
    const row = (byId.data as { team?: { id?: string; key?: string } })?.team;
    if (!row?.id) return { ok: false, error: `Team not found: ${team}` };
    return { ok: true, id: row.id, key: row.key };
  }
  const byKey = await gql(
    `query($key: String!) { teams(filter: { key: { eq: $key } }, first: 1) { nodes { id key } } }`,
    { key: team.toUpperCase() },
    hint
  );
  if (!byKey.ok) return byKey;
  const row = (byKey.data as { teams?: { nodes?: Array<{ id?: string; key?: string }> } })?.teams?.nodes?.[0];
  if (!row?.id) return { ok: false, error: `Team not found: ${team}` };
  return { ok: true, id: row.id, key: row.key };
}

export async function resolveLinearUserId(
  gql: LinearGraphqlFn,
  opts: { assigneeId?: string; email?: string; name?: string },
  hint?: string
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const id = opts.assigneeId?.trim();
  if (id === "") return { ok: true, id: null };
  if (id && id.length > 20) return { ok: true, id };

  const email = opts.email?.trim().toLowerCase();
  if (email) {
    const result = await gql(
      `query($email: String!) {
        users(filter: { email: { eq: $email } }, first: 1) { nodes { id name email } }
      }`,
      { email },
      hint
    );
    if (!result.ok) return result;
    const user = (result.data as { users?: { nodes?: Array<{ id?: string }> } })?.users?.nodes?.[0];
    if (!user?.id) return { ok: false, error: `No Linear user with email ${email}` };
    return { ok: true, id: user.id };
  }

  const name = opts.name?.trim();
  if (name) {
    const result = await gql(
      `query($name: String!) {
        users(filter: { name: { containsIgnoreCase: $name } }, first: 5) { nodes { id name email } }
      }`,
      { name },
      hint
    );
    if (!result.ok) return result;
    const nodes =
      (result.data as { users?: { nodes?: Array<{ id?: string; name?: string }> } })?.users?.nodes ?? [];
    const exact = nodes.find((u) => u.name?.toLowerCase() === name.toLowerCase());
    const pick = exact ?? nodes[0];
    if (!pick?.id) return { ok: false, error: `No Linear user matching name ${name}` };
    return { ok: true, id: pick.id };
  }

  if (id) return { ok: true, id };
  return { ok: false, error: "assignee_id, assignee_email, or assignee_name is required" };
}

export async function resolveLinearWorkflowStateId(
  gql: LinearGraphqlFn,
  stateName: string,
  opts: { teamId?: string; teamKey?: string },
  hint?: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const name = stateName.trim();
  if (!name) return { ok: false, error: "state_name is required" };

  const teamKey = opts.teamKey?.trim().toUpperCase();
  const teamId = opts.teamId?.trim();

  const filter: Record<string, unknown> = { name: { eq: name } };
  if (teamId) filter.team = { id: { eq: teamId } };
  else if (teamKey) filter.team = { key: { eq: teamKey } };

  const result = await gql(
    `query($filter: WorkflowStateFilter!, $first: Int!) {
      workflowStates(filter: $filter, first: $first) {
        nodes { id name type team { key name } }
      }
    }`,
    { filter, first: teamId || teamKey ? 5 : 15 },
    hint
  );
  if (!result.ok) return result;

  const states =
    (result.data as { workflowStates?: { nodes?: Array<{ id?: string }> } })?.workflowStates?.nodes ?? [];
  if (states.length === 0) {
    return {
      ok: false,
      error: `No workflow state "${name}"${teamKey ? ` for team ${teamKey}` : ""}. Use linear_list_workflow_states.`,
    };
  }
  if (states.length > 1 && !teamId && !teamKey) {
    return {
      ok: false,
      error: `Multiple states named "${name}" — pass team_key.`,
    };
  }
  const stateId = states[0]?.id;
  if (!stateId) return { ok: false, error: `Could not resolve state "${name}"` };
  return { ok: true, id: stateId };
}

export async function resolveLinearLabelIds(
  gql: LinearGraphqlFn,
  names: string[],
  opts: { teamId?: string; teamKey?: string },
  hint?: string
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const want = names.map((n) => n.trim()).filter(Boolean);
  if (want.length === 0) return { ok: true, ids: [] };

  const filter: Record<string, unknown> = { name: { in: want } };
  if (opts.teamId) filter.team = { id: { eq: opts.teamId } };
  else if (opts.teamKey) filter.team = { key: { eq: opts.teamKey.toUpperCase() } };

  const result = await gql(
    `query($filter: IssueLabelFilter!, $first: Int!) {
      issueLabels(filter: $filter, first: $first) { nodes { id name } }
    }`,
    { filter, first: Math.max(50, want.length) },
    hint
  );
  if (!result.ok) return result;

  const nodes = (result.data as { issueLabels?: { nodes?: Array<{ id?: string; name?: string }> } })
    ?.issueLabels?.nodes ?? [];
  const byName = new Map(nodes.map((n) => [n.name?.toLowerCase(), n.id]));
  const ids: string[] = [];
  const missing: string[] = [];
  for (const name of want) {
    const id = byName.get(name.toLowerCase());
    if (id) ids.push(id);
    else missing.push(name);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Unknown labels: ${missing.join(", ")}. Use linear_list_labels.`,
    };
  }
  return { ok: true, ids };
}

export async function resolveLinearProjectId(
  gql: LinearGraphqlFn,
  ref: string,
  hint?: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const project = ref.trim();
  if (!project) return { ok: false, error: "project is required" };
  if (project.length > 24) {
    const byId = await gql(`query($id: String!) { project(id: $id) { id name } }`, { id: project }, hint);
    if (!byId.ok) return byId;
    const id = (byId.data as { project?: { id?: string } })?.project?.id;
    if (!id) return { ok: false, error: `Project not found: ${project}` };
    return { ok: true, id };
  }
  const byName = await gql(
    `query($name: String!) {
      projects(filter: { name: { eq: $name } }, first: 1) { nodes { id name } }
    }`,
    { name: project },
    hint
  );
  if (!byName.ok) return byName;
  const id = (byName.data as { projects?: { nodes?: Array<{ id?: string }> } })?.projects?.nodes?.[0]?.id;
  if (!id) return { ok: false, error: `Project not found: ${project}` };
  return { ok: true, id };
}

export async function resolveLinearCycleId(
  gql: LinearGraphqlFn,
  ref: string,
  opts: { teamId?: string; teamKey?: string },
  hint?: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const cycle = ref.trim();
  if (!cycle) return { ok: false, error: "cycle is required" };
  if (cycle.length > 20) {
    return { ok: true, id: cycle };
  }

  const filter: Record<string, unknown> = {};
  if (opts.teamId) filter.team = { id: { eq: opts.teamId } };
  else if (opts.teamKey) filter.team = { key: { eq: opts.teamKey.toUpperCase() } };

  const num = Number(cycle);
  if (Number.isFinite(num) && num > 0) {
    filter.number = { eq: num };
  } else {
    filter.name = { containsIgnoreCase: cycle };
  }

  const result = await gql(
    `query($filter: CycleFilter!, $first: Int!) {
      cycles(filter: $filter, first: $first) { nodes { id name number team { key } } }
    }`,
    { filter, first: 5 },
    hint
  );
  if (!result.ok) return result;
  const nodes = (result.data as { cycles?: { nodes?: Array<{ id?: string }> } })?.cycles?.nodes ?? [];
  const id = nodes[0]?.id;
  if (!id) return { ok: false, error: `Cycle not found: ${cycle}. Use linear_list_cycles.` };
  return { ok: true, id };
}

/** Search issues — tries searchIssues then issueSearch (schema varies). */
export async function linearSearchIssues(
  gql: LinearGraphqlFn,
  term: string,
  opts: { first: number; teamKey?: string },
  hint?: string
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const teamKey = opts.teamKey?.trim().toUpperCase();
  const attempts: Array<{ query: string; variables: Record<string, unknown> }> = [
    teamKey
      ? {
          query: `query($term: String!, $first: Int!, $teamKey: String!) {
            searchIssues(term: $term, first: $first, filter: { team: { key: { eq: $teamKey } } }) {
              nodes { id identifier title state { name } assignee { name } url }
            }
          }`,
          variables: { term, first: opts.first, teamKey },
        }
      : {
          query: `query($term: String!, $first: Int!) {
            searchIssues(term: $term, first: $first) {
              nodes { id identifier title state { name } assignee { name } url }
            }
          }`,
          variables: { term, first: opts.first },
        },
    teamKey
      ? {
          query: `query($query: String!, $first: Int!, $teamKey: String!) {
            issueSearch(query: $query, first: $first, filter: { team: { key: { eq: $teamKey } } }) {
              nodes { id identifier title state { name } assignee { name } url }
            }
          }`,
          variables: { query: term, first: opts.first, teamKey },
        }
      : {
          query: `query($query: String!, $first: Int!) {
            issueSearch(query: $query, first: $first) {
              nodes { id identifier title state { name } assignee { name } url }
            }
          }`,
          variables: { query: term, first: opts.first },
        },
  ];

  let lastError = "search failed";
  for (const attempt of attempts) {
    const result = await gql(attempt.query, attempt.variables, hint);
    if (result.ok) return result;
    lastError = result.error;
    if (!lastError.includes("Cannot query field") && !lastError.includes("Unknown field")) {
      return result;
    }
  }
  return { ok: false, error: lastError };
}
