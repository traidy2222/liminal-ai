import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "@liminal/core";
import { serverFrame } from "@liminal/protocol";
import { ChatOrchestrator } from "./chat_orchestrator.js";
import { registerOrchestratorChatTools } from "./orchestrator_chat_tools.js";
import { buildOrchestratorRuntimeStatus } from "./orchestrator_chat_prompt.js";
import { createDesktopChatId } from "./chat_registry.js";

test("parallel worker chats get distinct IDs within the same millisecond", () => {
  const ids = Array.from({length: 100}, () => createDesktopChatId("default", 1234));
  assert.equal(new Set(ids).size, ids.length);
});

test("synthesis preserves useful output but cannot mark a failed worker mission complete", async () => {
  const orchestrator = new ChatOrchestrator({registry: {get: () => undefined}, emit() {}} as any) as any;
  orchestrator.plan = async () => ({tasks: [{id: "a", title: "Alpha"}, {id: "b", title: "Beta"}]});
  orchestrator.runWorker = async (_goal: string, task: {id: string}) => {
    if (task.id === "a") throw Error("worker failed");
    return {status: "done", summary: "Beta ready", artifacts: [], commandsRun: [], decisions: [], blockers: []};
  };
  orchestrator.runSynthesis = async () => ({chatId: "synthesis", text: "Beta ready; Alpha missing"});
  orchestrator.start("Two deliverables");
  await orchestrator.runChain;
  const result = orchestrator.getSnapshot();
  assert.equal(result.status, "failed");
  assert.match(result.error, /Alpha/);
  assert.equal(result.summary, "Beta ready; Alpha missing");
});

test("Mission Control exposes its tools with lazy loading enabled", () => {
  const registry = new ToolRegistry();
  registry.setLazyToolLoading(true);
  registerOrchestratorChatTools(registry, {} as any, "mission-control");
  const visible = registry.toOpenAIFormat().map(t => t.function.name);
  for (const name of ["start_mission", "mission_status", "stop_mission"]) {
    assert.ok(visible.includes(name), `${name} must be callable without discovery`);
    assert.equal(registry.getSuggestedFamilyForTool(name), "orchestration");
  }
});

test("runtime status gives fresh bounded worker counts without copying goals or worker output", () => {
  const snapshot = { status: "running", goal: "private goal", summary: "x".repeat(10000),
    workers: [{ status: "running", title: "x".repeat(10000) }, { status: "pending" }] } as any;
  const hint = buildOrchestratorRuntimeStatus(snapshot);
  assert.ok(hint.length < 300);
  assert.ok(!hint.includes("private goal"));
  assert.deepEqual(JSON.parse(hint.slice('[MISSION_RUNTIME] '.length)), {
    status: "running", workers: { total: 2, pending: 1, running: 1, done: 0, failed: 0, skipped: 0 },
  });
  snapshot.workers[0].status = "done";
  const next = JSON.parse(buildOrchestratorRuntimeStatus(snapshot).slice('[MISSION_RUNTIME] '.length));
  assert.equal(next.workers.done, 1); assert.equal(next.workers.running, 0);
});

test("Mission Control remains available while worker planning is pending", async () => {
  let release!: (plan: { tasks: [] }) => void;
  const planning = new Promise<{ tasks: [] }>((r) => { release = r; });
  const orchestrator = new ChatOrchestrator({ registry: { get: () => undefined }, emit() {} } as any) as any;
  orchestrator.plan = () => planning;
  const registry = new ToolRegistry();
  registerOrchestratorChatTools(registry, orchestrator, "mission-control");
  const started = await registry.get("start_mission")!.handler({ goal: "Build the deliverable" });
  assert.equal(started.ok, true);
  const status = await registry.get("mission_status")!.handler({});
  assert.equal(status.ok, true);
  if (status.ok) assert.match(status.output, /planning/);
  orchestrator.stop(); release({ tasks: [] }); await orchestrator.runChain;
});

test("worker completion waits for an ongoing conversation, then delivers a spoken update once", async () => {
  let busy = true;
  const deliveries: unknown[] = [];
  const parent = { get isBusy() { return busy; }, voiceSessionActive: true,
    sendUserMessage: async (_message: string, opts: unknown) => { deliveries.push(opts); } };
  const orchestrator = new ChatOrchestrator({ registry: { get: () => parent }, emit() {} } as any) as any;
  orchestrator.snapshot = { id: "mission", status: "completed", finishedAt: 1, parentChatId: "parent", summary: "Ready", workers: [] };
  await orchestrator.maybeNotifyParentChat(); assert.equal(deliveries.length, 0);
  busy = false;
  const frame = serverFrame("turn_end", { contextSnapshot: { tokenCount: 0, maxTokens: 1000, usageFraction: 0, masked: false }, durationMs: 1 }, "parent");
  orchestrator.handleFrame(frame);
  await new Promise((r) => setTimeout(r, 20));
  orchestrator.handleFrame(frame);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(deliveries, [{ freshContext: false, liveDictation: true }]);
});
