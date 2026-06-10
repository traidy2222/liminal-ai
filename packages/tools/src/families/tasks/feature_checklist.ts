/**
 * Long-horizon feature checklist (agent_features.json at workspace root).
 * Complements task_checkpoint / AGENT_PROGRESS.md — strict passes field discipline.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";

const FILENAME = "agent_features.json";

export interface FeatureItem {
  id: string;
  description: string;
  passes: boolean;
  steps?: string[];
}

function checklistPath(): string {
  return join(resolveWorkspaceRoot(), FILENAME);
}

async function readChecklist(): Promise<FeatureItem[]> {
  try {
    const raw = await readFile(checklistPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: FeatureItem[] = [];
    for (const x of parsed) {
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const id = typeof o["id"] === "string" ? o["id"] : "";
      const description = typeof o["description"] === "string" ? o["description"] : "";
      if (!id || !description) continue;
      out.push({
        id,
        description,
        passes: o["passes"] === true,
        steps: Array.isArray(o["steps"])
          ? (o["steps"] as unknown[]).filter((s): s is string => typeof s === "string")
          : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function writeChecklist(items: FeatureItem[]): Promise<void> {
  await writeFile(checklistPath(), JSON.stringify(items, null, 2), "utf8");
}

export const featureChecklistTool = defineTool({
  name: "feature_checklist",
  description:
    "WHAT: Read or update agent_features.json (long-horizon checklist at workspace root).\n" +
    "WHEN: Multi-session projects — initializer creates items; coding marks passes after verification.\n" +
    "OPS: read — return JSON; set_passes — flip passes for one id; write — replace entire list (initializer).\n" +
    "Do not delete unrelated items; only add or set passes on verified features.",
  requiresApproval: true,
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["read", "set_passes", "write"],
        description: "read | set_passes | write",
      },
      id: {
        type: "string",
        description: "Feature id (for set_passes)",
      },
      passes: {
        type: "boolean",
        description: "New passes value (for set_passes)",
      },
      features: {
        type: "array",
        description: "Full replacement list (for write only) — objects with id, description, passes",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            description: { type: "string" },
            passes: { type: "boolean" },
            steps: { type: "array", items: { type: "string" } },
          },
          required: ["id", "description", "passes"],
        },
      },
    },
    required: ["operation"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const op = args["operation"] as string;
    const pathStr = checklistPath();

    if (op === "read") {
      const items = await readChecklist();
      return {
        ok: true as const,
        output:
          items.length === 0
            ? `(no ${FILENAME} yet — use operation write from initializer mode)`
            : JSON.stringify(items, null, 2),
      };
    }

    if (op === "set_passes") {
      const id = args["id"] as string | undefined;
      const passes = args["passes"] as boolean | undefined;
      if (!id || typeof passes !== "boolean") {
        return { ok: false as const, error: "set_passes requires id (string) and passes (boolean)." };
      }
      const items = await readChecklist();
      if (items.length === 0) {
        return { ok: false as const, error: `No checklist at ${pathStr} — use write first.` };
      }
      let hit = false;
      const next = items.map((it) => {
        if (it.id === id) {
          hit = true;
          return { ...it, passes };
        }
        return it;
      });
      if (!hit) {
        return { ok: false as const, error: `No feature with id "${id}".` };
      }
      await writeChecklist(next);
      return { ok: true as const, output: `Updated ${id}. passes=${passes}. Wrote ${pathStr}.` };
    }

    if (op === "write") {
      const raw = args["features"] as FeatureItem[] | undefined;
      if (!raw || !Array.isArray(raw) || raw.length === 0) {
        return { ok: false as const, error: "write requires non-empty features array." };
      }
      const cleaned: FeatureItem[] = [];
      for (const it of raw) {
        if (!it.id || !it.description || typeof it.passes !== "boolean") continue;
        cleaned.push({
          id: String(it.id).slice(0, 128),
          description: String(it.description).slice(0, 2000),
          passes: it.passes,
          steps: it.steps?.map((s) => String(s).slice(0, 500)).slice(0, 20),
        });
      }
      if (cleaned.length === 0) {
        return { ok: false as const, error: "No valid feature objects (need id, description, passes)." };
      }
      await writeChecklist(cleaned);
      return { ok: true as const, output: `Wrote ${cleaned.length} feature(s) to ${pathStr}.` };
    }

    return { ok: false as const, error: `Unknown operation: ${op}` };
  },
});
