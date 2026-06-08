export type WorkerHandoffStatus = "done" | "blocked" | "partial";

export interface WorkerHandoff {
  status: WorkerHandoffStatus;
  artifacts: string[];
  commandsRun: string[];
  decisions: string[];
  blockers: string[];
  summary: string;
}

export const WORKER_HANDOFF_SCHEMA_HINT = `{
  "status": "done | blocked | partial",
  "artifacts": ["path/to/file"],
  "commandsRun": ["npm test"],
  "decisions": ["..."],
  "blockers": [],
  "summary": "one-paragraph outcome"
}`;

const HANDOFF_STATUSES = new Set<WorkerHandoffStatus>(["done", "blocked", "partial"]);

export function validateWorkerHandoff(
  raw: unknown
): { ok: true; handoff: WorkerHandoff } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Handoff must be a JSON object." };
  }
  const o = raw as Record<string, unknown>;

  const status = String(o.status ?? "").trim() as WorkerHandoffStatus;
  if (!HANDOFF_STATUSES.has(status)) {
    return { ok: false, error: `status must be one of: done, blocked, partial (got ${JSON.stringify(o.status)}).` };
  }

  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!summary) {
    return { ok: false, error: "summary is required (non-empty string)." };
  }

  const artifacts = readStringArray(o.artifacts, "artifacts");
  if (!artifacts.ok) return artifacts;
  const commandsRun = readStringArray(o.commandsRun, "commandsRun");
  if (!commandsRun.ok) return commandsRun;
  const decisions = readStringArray(o.decisions, "decisions");
  if (!decisions.ok) return decisions;
  const blockers = readStringArray(o.blockers, "blockers");
  if (!blockers.ok) return blockers;

  if (status === "blocked" && blockers.values.length === 0) {
    return { ok: false, error: 'status "blocked" requires at least one entry in blockers.' };
  }

  return {
    ok: true,
    handoff: {
      status,
      summary,
      artifacts: artifacts.values,
      commandsRun: commandsRun.values,
      decisions: decisions.values,
      blockers: blockers.values,
    },
  };
}

function readStringArray(
  value: unknown,
  field: string
): { ok: true; values: string[] } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, values: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, error: `${field} must be an array of strings.` };
  }
  for (const entry of value) {
    if (typeof entry !== "string") {
      return { ok: false, error: `${field} must be an array of strings.` };
    }
  }
  return { ok: true, values: value.map((s) => s.trim()).filter(Boolean) };
}

export function parseWorkerHandoff(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const jsonFences = [...trimmed.matchAll(/```json\s*([\s\S]*?)```/gi)].map((m) => m[1]!.trim());
  for (let i = jsonFences.length - 1; i >= 0; i--) {
    const parsed = tryParseJson(jsonFences[i]!);
    if (parsed !== null) return parsed;
  }

  const plainFences = [...trimmed.matchAll(/```\s*([\s\S]*?)```/g)].map((m) => m[1]!.trim());
  for (let i = plainFences.length - 1; i >= 0; i--) {
    const block = plainFences[i]!;
    if (!block.startsWith("{")) continue;
    const parsed = tryParseJson(block);
    if (parsed !== null) return parsed;
  }

  const fromBrace = extractLastJsonObject(trimmed);
  if (fromBrace !== null) return fromBrace;

  return null;
}

export function parseAndValidateWorkerHandoff(
  text: string
): { ok: true; handoff: WorkerHandoff } | { ok: false; error: string } {
  const raw = parseWorkerHandoff(text);
  if (raw === null) {
    return {
      ok: false,
      error:
        "No JSON handoff found. End your message with a ```json code fence matching the required schema.",
    };
  }
  return validateWorkerHandoff(raw);
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractLastJsonObject(text: string): unknown | null {
  const start = text.lastIndexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return tryParseJson(text.slice(start, i + 1));
      }
    }
  }
  return null;
}

export function formatHandoffForUpstream(taskId: string, title: string, handoff: WorkerHandoff): string {
  return `### ${title} (${taskId})\n\`\`\`json\n${JSON.stringify(handoff, null, 2)}\n\`\`\``;
}

export function formatHandoffsForSynthesis(
  workers: Array<{ taskId: string; title: string; handoff: WorkerHandoff }>
): string {
  const payload = workers.map((w) => ({
    taskId: w.taskId,
    title: w.title,
    ...w.handoff,
  }));
  return JSON.stringify(payload, null, 2);
}

export function buildHandoffRetryMessage(validationError: string): string {
  return [
    "[ORCHESTRATION — handoff rejected]",
    "Your previous reply did not include a valid JSON handoff.",
    "",
    `Validation error: ${validationError}`,
    "",
    "Reply again. Your final message MUST end with a ```json fence using exactly this shape:",
    WORKER_HANDOFF_SCHEMA_HINT,
    "",
    "- status: done = slice complete; blocked = could not finish (list blockers); partial = incomplete but useful",
    "- artifacts: real repo paths you created or changed (empty array if none)",
    "- commandsRun: shell/test commands you ran (empty array if none)",
    "- decisions: non-obvious choices you made",
    "- blockers: required when status is blocked",
    "- summary: concise prose for humans",
  ].join("\n");
}
