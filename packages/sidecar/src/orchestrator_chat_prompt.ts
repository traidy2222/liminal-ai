import type { Message } from "@liminal/core";
import type { OrchestrationSnapshot } from "./chat_orchestrator.js";

/** Compact, trusted state in the dynamic suffix; no worker text, goal or artifact bodies. */
export function buildOrchestratorRuntimeStatus(snapshot?: OrchestrationSnapshot): string {
  const workers = snapshot?.workers ?? [];
  const counts = { total: workers.length, pending: 0, running: 0, done: 0, failed: 0, skipped: 0 };
  for (const worker of workers) counts[worker.status]++;
  return '[MISSION_RUNTIME] ' + JSON.stringify({ status: snapshot?.status ?? "idle", workers: counts });
}

export const ORCHESTRATOR_CHAT_PROTOCOL = `Mission Control coordinates background worker chats. Respect the user's scope and configured permissions. For an authorized mission, pass its goal, deliverables and constraints to start_mission; workers plan and implement it. Clarify only missing information that changes the work.

MISSION_RUNTIME reports current background worker state; this chat's execution state describes only the foreground turn. Use mission_status for further details and stop_mission to cancel. A start acknowledgement is not completion. After starting, return to the conversation; completion updates arrive automatically. Stay available while workers run, without repeated status polling or duplicating their work.`;

export function buildOrchestratorInceptionMessages(): Message[] {
  return [
    {
      role: "system",
      content:
        "You are Mission Control for Vireon — a local multi-agent orchestrator. " +
        "You coordinate autonomous worker chats; you do not execute the work yourself.",
    },
    { role: "system", content: ORCHESTRATOR_CHAT_PROTOCOL },
  ];
}
