/**
 * Task scheduler — recurring task definitions with overdue detection.
 * Persisted at <workspace>/.agent_schedules.json
 *
 * Each schedule has:
 *   id, name, description, interval_hours, last_run (ISO string | null)
 *
 * Tools:
 *   schedule_create — define a recurring task
 *   schedule_list   — list all schedules with overdue status
 *   schedule_delete — remove a schedule
 *   schedule_run    — mark a schedule as just-run (updates last_run)
 */

import type { ToolDefinition } from "@liminal/core";
import * as fs from "fs/promises";
import * as path from "path";
import { resolveWorkspaceRoot } from "@liminal/core";

const SCHEDULE_FILE = ".agent_schedules.json";

interface Schedule {
  id: string;
  name: string;
  description: string;
  interval_hours: number;
  last_run: string | null;
}

interface ScheduleStore {
  schedules: Schedule[];
}

function schedulePath(): string {
  return path.join(resolveWorkspaceRoot(), SCHEDULE_FILE);
}

async function readStore(): Promise<ScheduleStore> {
  try {
    const raw = await fs.readFile(schedulePath(), "utf-8");
    return JSON.parse(raw) as ScheduleStore;
  } catch {
    return { schedules: [] };
  }
}

async function writeStore(store: ScheduleStore): Promise<void> {
  await fs.writeFile(schedulePath(), JSON.stringify(store, null, 2), "utf-8");
}

function isOverdue(s: Schedule): boolean {
  if (!s.last_run) return true;
  const elapsed = (Date.now() - new Date(s.last_run).getTime()) / 3_600_000;
  return elapsed >= s.interval_hours;
}

function overdueLabel(s: Schedule): string {
  if (!s.last_run) return "never run";
  const elapsed = (Date.now() - new Date(s.last_run).getTime()) / 3_600_000;
  if (elapsed < s.interval_hours) {
    const remaining = s.interval_hours - elapsed;
    return remaining < 24
      ? `due in ${Math.round(remaining)}h`
      : `due in ${Math.round(remaining / 24)}d`;
  }
  const overdue = elapsed - s.interval_hours;
  return overdue < 24
    ? `OVERDUE by ${Math.round(overdue)}h`
    : `OVERDUE by ${Math.round(overdue / 24)}d`;
}

function makeId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
}

// ─── schedule_create ──────────────────────────────────────────────────────────

export const scheduleCreateTool: ToolDefinition = {
  name: "schedule_create",
  requiresApproval: false,
  description:
    "Define a recurring harness task (e.g. weekly synthesis, daily briefing). " +
    "Overdue schedules are surfaced in every world context.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short identifier (e.g. 'weekly_synthesis')." },
      description: {
        type: "string",
        description: "What this task does — shown in world context when overdue.",
      },
      interval_hours: {
        type: "number",
        description: "Recurrence interval in hours (e.g. 168 for weekly).",
      },
    },
    required: ["name", "description", "interval_hours"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const name = args["name"] as string;
    const description = args["description"] as string;
    const interval_hours = args["interval_hours"] as number;

    const store = await readStore();
    const id = makeId(name);

    if (store.schedules.find((s) => s.id === id)) {
      return { ok: false, error: `Schedule '${id}' already exists. Delete it first to recreate.` };
    }

    const schedule: Schedule = { id, name, description, interval_hours, last_run: null };
    store.schedules.push(schedule);
    await writeStore(store);

    return {
      ok: true,
      output: `Schedule '${id}' created — every ${interval_hours}h. Call schedule_run('${id}') after completing it to reset the clock.`,
    };
  },
};

// ─── schedule_list ────────────────────────────────────────────────────────────

export const scheduleListTool: ToolDefinition = {
  name: "schedule_list",
  requiresApproval: false,
  description: "List all recurring schedules with their overdue status.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  handler: async () => {
    const store = await readStore();
    if (store.schedules.length === 0) {
      return { ok: true, output: "No schedules defined. Use schedule_create to add one." };
    }
    const rows = store.schedules.map((s) => {
      const status = overdueLabel(s);
      return `• [${s.id}] ${s.name} (every ${s.interval_hours}h) — ${status}\n  ${s.description}`;
    });
    return { ok: true, output: rows.join("\n") };
  },
};

// ─── schedule_delete ──────────────────────────────────────────────────────────

export const scheduleDeleteTool: ToolDefinition = {
  name: "schedule_delete",
  requiresApproval: false,
  description: "Remove a recurring schedule by id.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Schedule id to delete." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = args["id"] as string;
    const store = await readStore();
    const before = store.schedules.length;
    store.schedules = store.schedules.filter((s) => s.id !== id);
    if (store.schedules.length === before) {
      return { ok: false, error: `No schedule found with id '${id}'.` };
    }
    await writeStore(store);
    return { ok: true, output: `Schedule '${id}' deleted.` };
  },
};

// ─── schedule_run ─────────────────────────────────────────────────────────────

export const scheduleRunTool: ToolDefinition = {
  name: "schedule_run",
  requiresApproval: false,
  description:
    "Mark a recurring schedule as completed now (resets its last_run clock). " +
    "Call this after actually performing the scheduled task.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Schedule id to mark as run." },
    },
    required: ["id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const id = args["id"] as string;
    const store = await readStore();
    const s = store.schedules.find((s) => s.id === id);
    if (!s) {
      return { ok: false, error: `No schedule found with id '${id}'.` };
    }
    s.last_run = new Date().toISOString();
    await writeStore(store);
    return {
      ok: true,
      output: `Schedule '${id}' marked as run. Next due in ${s.interval_hours}h.`,
    };
  },
};

// ─── World-context gatherer (exported for use in world_context.ts) ─────────────

export async function gatherOverdueSchedules(): Promise<string[] | null> {
  const store = await readStore();
  const overdue = store.schedules.filter(isOverdue);
  if (overdue.length === 0) return null;

  const lines: string[] = [`[OVERDUE SCHEDULES — ${overdue.length} task(s) pending]`];
  for (const s of overdue) {
    lines.push(`  • ${s.name} (${overdueLabel(s)}): ${s.description}`);
  }
  lines.push(`  → Call schedule_run('<id>') after completing each task.`);
  return lines;
}
