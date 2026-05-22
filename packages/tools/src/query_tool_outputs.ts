/**
 * query_tool_outputs — harness-scoped tool that queries the in-session
 * BM25 index of all tool outputs from the current send().
 *
 * Lets the model retrieve specific facts from earlier tool calls without
 * re-issuing the original call or scanning the context window.
 */

import type { AgentHarness } from "@liminal/core";
import { defineTool } from "./helpers.js";

export function createQueryToolOutputsTool(harness: AgentHarness) {
  return defineTool({
    name: "query_tool_outputs",
    description:
      "Search tool outputs from the current session turn using BM25. Returns ranked excerpts. " +
      "Use when you need a specific fact from an earlier tool result without re-calling the tool.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query to search across all tool outputs this turn.",
          minLength: 2,
          maxLength: 500,
        },
        tool_name: {
          type: "string",
          description: "Optional: restrict results to outputs from this tool name.",
          maxLength: 80,
        },
        top_k: {
          type: "number",
          description: "Max results to return (1–10, default 5).",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["query"],
    },
    requiresApproval: false,
    cacheable: false,
    handler: async (args) => {
      const query = String(args["query"] ?? "").trim();
      const toolNameFilter = args["tool_name"] ? String(args["tool_name"]).trim() : undefined;
      const topK = Math.max(1, Math.min(10, Number(args["top_k"] ?? 5) || 5));

      const index = harness.getSessionToolIndex();
      if (!index || index.size() === 0) {
        return {
          ok: true,
          output: "(no tool outputs indexed yet this turn)",
        };
      }

      let results = index.query(query, topK * 2);

      if (toolNameFilter) {
        results = results.filter((r) => r.toolName === toolNameFilter);
      }

      results = results.slice(0, topK);

      if (results.length === 0) {
        return {
          ok: true,
          output: `No matching tool outputs found for query: "${query}"`,
        };
      }

      const lines: string[] = [
        `Found ${results.length} matching excerpt(s) for query: "${query}"`,
        `(Total indexed this turn: ${index.size()} tool calls)`,
        "",
      ];

      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        lines.push(`[${i + 1}] tool=${r.toolName}  callId=${r.callId}  score=${r.score.toFixed(3)}`);
        lines.push(r.excerpt);
        lines.push("");
      }

      return { ok: true, output: lines.join("\n") };
    },
  });
}
