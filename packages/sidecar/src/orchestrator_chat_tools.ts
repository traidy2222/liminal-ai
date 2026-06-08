import { defineTool } from "@liminal/tools";
import type { ToolRegistry } from "@liminal/core";
import type { ChatOrchestrator } from "./chat_orchestrator.js";

export function registerOrchestratorChatTools(
  registry: ToolRegistry,
  orchestrator: ChatOrchestrator,
  parentChatId: string
): void {
  registry.register(
    defineTool({
      name: "start_mission",
      description:
        "WHAT: Start an autonomous multi-worker mission (plan → worker chats → synthesis).\n" +
        "WHEN: The user wants work done and the goal is clear enough to run.\n" +
        "NOT WHEN: A mission is already planning/running/synthesizing — check mission_status first.",
      requiresApproval: false,
      dangerLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          goal: {
            type: "string",
            description: "Consolidated mission goal for the planner (include deliverables and constraints).",
          },
          max_workers: {
            type: "number",
            description: "Max worker chats to plan (1–6, default 4).",
          },
        },
        required: ["goal"],
        additionalProperties: false,
      },
      handler: async (args) => {
        const goal = String(args["goal"] ?? "").trim();
        if (!goal) return { ok: false, error: "goal is required." };
        const maxRaw = args["max_workers"];
        const maxWorkers =
          typeof maxRaw === "number" && Number.isFinite(maxRaw)
            ? Math.max(1, Math.min(6, Math.floor(maxRaw)))
            : undefined;
        try {
          const snap = orchestrator.start(goal, {
            maxWorkers,
            yolo: true,
            parentChatId,
          });
          const workerCount = snap.workers.length;
          const lines = [
            `Mission started (id: ${snap.id}).`,
            `Status: ${snap.status}${snap.phase ? ` — ${snap.phase}` : ""}`,
            workerCount > 0
              ? `Planned workers: ${workerCount} — ${snap.workers.map((w) => w.title).join(", ")}`
              : "Planning worker tasks…",
          ];
          return { ok: true, output: lines.join("\n") };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    })
  );

  registry.register(
    defineTool({
      name: "mission_status",
      description: "WHAT: Snapshot of the current or last orchestration run.",
      requiresApproval: false,
      dangerLevel: "safe",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      handler: async () => {
        const snap = orchestrator.getSnapshot();
        if (snap.status === "idle" && !snap.id) {
          return { ok: true, output: "No mission has run in this sidecar session yet." };
        }
        const workers = snap.workers
          .map(
            (w) =>
              `- ${w.title} (${w.taskId}): ${w.status}` +
              (w.handoff?.status ? ` handoff=${w.handoff.status}` : "") +
              (w.error ? ` — ${w.error}` : "")
          )
          .join("\n");
        const parts = [
          `Mission: ${snap.goal || "(none)"}`,
          `Status: ${snap.status}${snap.phase ? ` — ${snap.phase}` : ""}`,
          workers ? `Workers:\n${workers}` : "",
          snap.summary ? `Final summary:\n${snap.summary}` : "",
          snap.error ? `Error: ${snap.error}` : "",
        ].filter(Boolean);
        return { ok: true, output: parts.join("\n\n") };
      },
    })
  );

  registry.register(
    defineTool({
      name: "stop_mission",
      description: "WHAT: Cooperatively stop the active orchestration.",
      requiresApproval: false,
      dangerLevel: "cautious",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      handler: async () => {
        const ok = orchestrator.stop();
        return ok
          ? { ok: true, output: "Mission stop requested." }
          : { ok: false, error: "No active mission to stop." };
      },
    })
  );
}
