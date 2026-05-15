/**
 * Session agenda — persistent priority list shown in world context every turn.
 * Persisted as JSON at <workspace>/.agent_session_agenda.json
 *
 * Shape:
 *   { updatedAt: ISO string, items: string[] }
 *
 * Tools:
 *   agenda_set   — replace the entire agenda list
 *   agenda_get   — read the current agenda
 *   agenda_clear — wipe it
 */

import type { ToolDefinition } from "@liminal/core";
import * as fs from "fs/promises";
import * as path from "path";
import { resolveWorkspaceRoot } from "@liminal/core";

const AGENDA_FILE = ".agent_session_agenda.json";

interface AgendaStore {
  updatedAt: string;
  items: string[];
}

function agendaPath(): string {
  return path.join(resolveWorkspaceRoot(), AGENDA_FILE);
}

async function readAgenda(): Promise<AgendaStore | null> {
  try {
    const raw = await fs.readFile(agendaPath(), "utf-8");
    return JSON.parse(raw) as AgendaStore;
  } catch {
    return null;
  }
}

async function writeAgenda(store: AgendaStore): Promise<void> {
  await fs.writeFile(agendaPath(), JSON.stringify(store, null, 2), "utf-8");
}

// ─── agenda_set ───────────────────────────────────────────────────────────────

export const agendaSetTool: ToolDefinition = {
  name: "agenda_set",
  requiresApproval: true,
  description:
    "Replace the session agenda (top-priority list shown in every world context). " +
    "Pass an ordered array of plain-text items — most important first.",
  parameters: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: { type: "string" },
        description: "Ordered list of agenda items, most important first.",
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const items = args["items"] as string[];
    const store: AgendaStore = { updatedAt: new Date().toISOString(), items };
    await writeAgenda(store);
    return {
      ok: true,
      output: `Agenda updated (${items.length} items). It will appear in every world context until cleared.`,
    };
  },
};

// ─── agenda_get ───────────────────────────────────────────────────────────────

export const agendaGetTool: ToolDefinition = {
  name: "agenda_get",
  requiresApproval: false,
  description: "Read the current session agenda.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  handler: async () => {
    const store = await readAgenda();
    if (!store || store.items.length === 0) {
      return { ok: true, output: "No agenda set. Use agenda_set to define priorities." };
    }
    const list = store.items.map((item, i) => `${i + 1}. ${item}`).join("\n");
    return {
      ok: true,
      output: `Session agenda (updated ${store.updatedAt}):\n${list}`,
    };
  },
};

// ─── agenda_clear ─────────────────────────────────────────────────────────────

export const agendaClearTool: ToolDefinition = {
  name: "agenda_clear",
  requiresApproval: true,
  description: "Clear the session agenda.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  handler: async () => {
    try {
      await fs.unlink(agendaPath());
    } catch { /* already gone */ }
    return { ok: true, output: "Agenda cleared." };
  },
};

// ─── World-context gatherer (exported for use in world_context.ts) ─────────────

export async function gatherSessionAgenda(): Promise<string[] | null> {
  const store = await readAgenda();
  if (!store || store.items.length === 0) return null;

  const staleDays = (Date.now() - new Date(store.updatedAt).getTime()) / 86_400_000;
  const staleNote = staleDays > 7 ? `  [stale — last updated ${Math.round(staleDays)}d ago]` : "";

  const lines: string[] = [
    `[SESSION AGENDA${staleNote}]`,
    ...store.items.map((item, i) => `  ${i + 1}. ${item}`),
  ];
  return lines;
}
