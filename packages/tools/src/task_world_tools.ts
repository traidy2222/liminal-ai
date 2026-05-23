import type { AgentHarness, TaskWorldVerificationStatus } from "@liminal/core";
import { formatTaskWorldSummary } from "@liminal/core";
import { defineTool } from "./helpers.js";

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((x) => String(x).trim()).filter(Boolean).slice(0, 40)
    : [];
}

function formatWorldJson(harness: AgentHarness): string {
  const world = harness.getActiveTaskWorld();
  return world ? JSON.stringify(world, null, 2) : "(no active task world)";
}

export function createTaskWorldTools(harness: AgentHarness) {
  const taskWorldStatusTool = defineTool({
    name: "task_world_status",
    description:
      "WHAT: Inspect the active Task World mission state: objective, evidence, verification, artifacts, and blackboard.\n" +
      "WHEN: Before resuming complex work, before final answers, or when the user asks what remains.\n" +
      "ARGS: verbose=false returns compact summary; verbose=true returns JSON snapshot.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        verbose: { type: "boolean", description: "Return full JSON snapshot instead of compact summary." },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const world = harness.getActiveTaskWorld();
      if (!world) return { ok: true, output: "(no active task world)" };
      return {
        ok: true,
        output: args["verbose"] === true ? JSON.stringify(world, null, 2) : formatTaskWorldSummary(world),
      };
    },
  });

  const taskWorldUpdateTool = defineTool({
    name: "task_world_update",
    description:
      "WHAT: Add a curated note to the active Task World blackboard.\n" +
      "KINDS: fact, evidence, handoff, decision, blocker, status.\n" +
      "WHEN: Record decisions, blockers, handoffs, or durable mission facts that should survive context compression.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["fact", "evidence", "handoff", "decision", "blocker", "status"],
        },
        summary: { type: "string", minLength: 1 },
        source: { type: "string" },
        payload: { type: "string" },
      },
      required: ["kind", "summary"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const world = await harness.updateTaskWorld({
        kind: args["kind"] as "fact" | "evidence" | "handoff" | "decision" | "blocker" | "status",
        summary: args["summary"] as string,
        source: typeof args["source"] === "string" ? args["source"] : undefined,
        payload: typeof args["payload"] === "string" ? args["payload"] : undefined,
      });
      return { ok: true, output: world ? formatTaskWorldSummary(world) : "(no active task world)" };
    },
  });

  const taskWorldEvidenceTool = defineTool({
    name: "task_world_evidence",
    description:
      "WHAT: Attach explicit evidence to a Task World claim.\n" +
      "WHEN: A file line, command output, source, browser observation, user statement, or sub-agent result supports a claim.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        claim: { type: "string", minLength: 1 },
        source_kind: {
          type: "string",
          enum: ["file", "command", "web", "browser", "tool", "user", "subagent"],
        },
        source_ref: { type: "string", minLength: 1 },
        excerpt: { type: "string", minLength: 1 },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        freshness: { type: "string", enum: ["live", "current", "stale", "unknown"] },
      },
      required: ["claim", "source_ref", "excerpt"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const world = await harness.addTaskWorldEvidence({
        claim: args["claim"] as string,
        sourceKind: (args["source_kind"] as Parameters<AgentHarness["addTaskWorldEvidence"]>[0]["sourceKind"]) ?? "tool",
        sourceRef: args["source_ref"] as string,
        excerpt: args["excerpt"] as string,
        confidence: args["confidence"] as Parameters<AgentHarness["addTaskWorldEvidence"]>[0]["confidence"],
        freshness: args["freshness"] as Parameters<AgentHarness["addTaskWorldEvidence"]>[0]["freshness"],
      });
      return { ok: true, output: world ? formatWorldJson(harness) : "(no active task world)" };
    },
  });

  const taskWorldVerifyTool = defineTool({
    name: "task_world_verify",
    description:
      "WHAT: Update or report Task World verification status.\n" +
      "WHEN: Before final answer, after tests/checks, or when explicitly waiving a missing criterion.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["not_started", "in_progress", "satisfied", "missing", "waived"] },
        criterion_id: { type: "string" },
        criterion_status: { type: "string", enum: ["not_started", "in_progress", "satisfied", "missing", "waived"] },
        evidence_ids: { type: "array", items: { type: "string" } },
        waived_reason: { type: "string" },
        residual_risks: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!harness.getActiveTaskWorld()) return { ok: true, output: "(no active task world)" };
      const world = await harness.updateTaskWorldVerification({
        status: args["status"] as TaskWorldVerificationStatus | undefined,
        criterionId: typeof args["criterion_id"] === "string" ? args["criterion_id"] : undefined,
        criterionStatus: args["criterion_status"] as TaskWorldVerificationStatus | undefined,
        evidenceIds: parseStringArray(args["evidence_ids"]),
        waivedReason: typeof args["waived_reason"] === "string" ? args["waived_reason"] : undefined,
        residualRisks: parseStringArray(args["residual_risks"]),
      });
      return { ok: true, output: world ? JSON.stringify(world.verification, null, 2) : "(no active task world)" };
    },
  });

  const taskWorldResumeTool = defineTool({
    name: "task_world_resume",
    description:
      "WHAT: Resume a persisted Task World from .agent_task_worlds/<world_id>/snapshot.json into the active harness context.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        world_id: { type: "string", minLength: 1 },
      },
      required: ["world_id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const world = await harness.resumeTaskWorld(args["world_id"] as string);
      if (!world) return { ok: false, error: `No task world found: ${args["world_id"]}` };
      return { ok: true, output: formatTaskWorldSummary(world) };
    },
  });

  return {
    taskWorldStatusTool,
    taskWorldUpdateTool,
    taskWorldEvidenceTool,
    taskWorldVerifyTool,
    taskWorldResumeTool,
  };
}
