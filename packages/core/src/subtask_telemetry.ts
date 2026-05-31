/**
 * Forward a child harness emitter stream to the parent as subtask-scoped events
 * so UIs can show live tool activity inside a sub-agent inspector.
 */
import type { AgentEmitter } from "./events.js";

export function wireSubtaskEventForwarding(
  parentEmitter: AgentEmitter,
  childEmitter: AgentEmitter,
  taskId: string
): void {

  childEmitter.on("tool_start", ({ callId, name }) => {
    parentEmitter.emit("subtask_tool_start", { taskId, callId, name });
  });

  childEmitter.on("tool_result", ({ callId, name, args, result }) => {
    parentEmitter.emit("subtask_tool_result", {
      taskId,
      callId,
      name,
      args,
      ok: result.ok,
      output: result.ok ? result.output : result.error,
    });
  });

  childEmitter.on("text", ({ delta, channel }) => {
    if (channel === "trace") {
      parentEmitter.emit("subtask_trace", { taskId, delta });
      return;
    }
    parentEmitter.emit("subtask_output", { taskId, delta });
  });
}
