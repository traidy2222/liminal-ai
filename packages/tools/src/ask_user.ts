import type { AgentEmitter } from "@dreamthedream/core";
import { defineTool } from "./helpers.js";

export function createAskUserTool(emitter: AgentEmitter) {
  return defineTool({
    name: "ask_user",
    description:
      "WHAT: Pause execution, surface a question to the user, and resume with their answer.\n" +
      "WHEN: Critical ambiguity that only the user can resolve — missing credentials, unclear intent, destructive-action confirmation.\n" +
      "NOT WHEN: A tool can discover the answer (list_dir, web_search, recall) or a reasonable assumption can be made and stated.\n" +
      "ARGS: prompt — the question to present to the user.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The question to ask the user" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const prompt = args["prompt"] as string;
      const answer = await new Promise<string>((resolve) => {
        emitter.emit("ask_user", { prompt, resolve });
      });
      // Emit answer back into event stream for audit trail (#7 — AgentTrace arXiv:2602.10133)
      emitter.emit("ask_user_answered", { prompt, answer });
      return { ok: true, output: answer };
    },
  });
}
