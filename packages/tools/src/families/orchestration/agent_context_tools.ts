/**
 * Session-scoped context sharing between parent/child/sibling agents via SharedMemoryBus.
 */
import type { AgentHarness, SharedBusEnvelope } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";

const MAX_PAYLOAD_CHARS = 24_000;
const MAX_SUMMARY_CHARS = 500;

export function createAgentContextTools(harness: AgentHarness) {
  const shareAgentContextTool = defineTool({
    name: "share_agent_context",
    description:
      "WHAT: Publish a curated context bundle for other agents in this session (sub-agents, siblings, parent).\n" +
      "WHEN: Before spawn_agent or when a downstream agent needs your findings, file paths, decisions, or partial results.\n" +
      "NOT WHEN: The data belongs in long-term memory — use remember/vault_write instead.\n" +
      "ARGS: key (namespace, e.g. \"research/pricing\"), summary (one line), payload (detailed markdown/text), type (fact|summary|evidence|handoff|status).",
    requiresApproval: false,
    dangerLevel: "safe",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Bus key — use ctx/<topic> or spawn/<task>/<topic>. Readable via read_agent_context.",
          minLength: 1,
          maxLength: 120,
        },
        summary: {
          type: "string",
          description: "One-line description for listings.",
          minLength: 1,
          maxLength: MAX_SUMMARY_CHARS,
        },
        payload: {
          type: "string",
          description: "Full curated context (markdown). Keep focused — downstream agents inject this verbatim.",
          minLength: 1,
          maxLength: MAX_PAYLOAD_CHARS,
        },
        type: {
          type: "string",
          enum: ["fact", "summary", "evidence", "handoff", "status"],
          description: "Envelope type (default: summary).",
        },
      },
      required: ["key", "summary", "payload"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const key = String(args["key"] ?? "").trim();
      const summary = String(args["summary"] ?? "").trim().slice(0, MAX_SUMMARY_CHARS);
      const payload = String(args["payload"] ?? "").trim().slice(0, MAX_PAYLOAD_CHARS);
      const typeRaw = String(args["type"] ?? "summary").trim().toLowerCase();
      const type = (["fact", "summary", "evidence", "handoff", "status"] as const).includes(
        typeRaw as SharedBusEnvelope["type"]
      )
        ? (typeRaw as SharedBusEnvelope["type"])
        : "summary";

      if (!key || !summary || !payload) {
        return { ok: false, error: "key, summary, and payload are required." };
      }

      const fullKey = key.startsWith("ctx/") ? key : `ctx/${harness.taskId.slice(0, 8)}/${key}`;
      const envelope: SharedBusEnvelope = {
        type,
        summary,
        payload,
        at: Date.now(),
      };
      harness.sharedBus.publishEnvelope(fullKey, envelope, harness.taskId);

      return {
        ok: true,
        output:
          `Published context to "${fullKey}" (${payload.length.toLocaleString()} chars, type=${type}).\n` +
          `Downstream: spawn_agent({ context_keys: ["${fullKey}"] }) or read_agent_context({ keys: ["${fullKey}"] }).`,
      };
    },
  });

  const readAgentContextTool = defineTool({
    name: "read_agent_context",
    description:
      "WHAT: Read curated context bundles published by you or other agents in this session.\n" +
      "WHEN: Starting work that builds on a sub-agent, sibling, or upstream dependency; before merging parallel branches.\n" +
      "ARGS: keys (explicit bus keys), prefix (e.g. \"ctx/\" or \"spawn/\"), include_upstream (inject depends_on / recent sub-agent outputs).",
    requiresApproval: false,
    dangerLevel: "safe",
    parameters: {
      type: "object",
      properties: {
        keys: {
          type: "array",
          items: { type: "string" },
          description: "Explicit shared-bus keys from share_agent_context or spawn handoffs.",
        },
        prefix: {
          type: "string",
          description: "List all keys starting with this prefix (e.g. ctx/, spawn/).",
          maxLength: 64,
        },
        include_upstream: {
          type: "boolean",
          description: "If true, include recent completed sub-agents under this harness (last 8).",
        },
        max_chars: {
          type: "number",
          description: "Max total output chars (default 12000).",
        },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const keys = Array.isArray(args["keys"])
        ? (args["keys"] as unknown[]).map((k) => String(k).trim()).filter(Boolean)
        : [];
      const prefix = typeof args["prefix"] === "string" ? args["prefix"].trim() : "";
      const includeUpstream = args["include_upstream"] === true;
      const maxChars = Math.min(
        32_000,
        Math.max(2000, typeof args["max_chars"] === "number" ? args["max_chars"] : 12_000)
      );

      const parts: string[] = [];
      const seen = new Set<string>();

      for (const key of keys) {
        if (seen.has(key)) continue;
        seen.add(key);
        const env = harness.sharedBus.readEnvelope(key);
        if (env) {
          parts.push(`[${key} · ${env.type}]\n${(env.payload ?? env.summary).slice(0, 4000)}`);
        } else {
          const raw = harness.sharedBus.read(key);
          if (raw?.trim()) parts.push(`[${key}]\n${raw.trim().slice(0, 3000)}`);
        }
      }

      if (prefix) {
        for (const [key, raw] of Object.entries(harness.sharedBus.getAll())) {
          if (!key.startsWith(prefix) || seen.has(key)) continue;
          seen.add(key);
          const env = harness.sharedBus.readEnvelope(key);
          if (env) {
            parts.push(`[${key} · ${env.type}]\n${(env.payload ?? env.summary).slice(0, 3000)}`);
          } else if (raw.trim()) {
            parts.push(`[${key}]\n${raw.trim().slice(0, 2000)}`);
          }
        }
      }

      if (includeUpstream) {
        const children = harness.orchestrator
          .getAll()
          .filter((t) => t.parentTaskId === harness.taskId && t.status === "done" && t.result?.trim())
          .slice(-8);
        for (const t of children) {
          parts.push(
            `[sub-agent ${t.taskId.slice(0, 8)} · ${t.goal}]\n${t.result!.trim().slice(0, 4000)}`
          );
        }
      }

      if (parts.length === 0) {
        return {
          ok: true,
          output:
            "No shared context found. Use share_agent_context to publish, or pass context_keys when spawning sub-agents.",
        };
      }

      const out = parts.join("\n\n---\n\n").slice(0, maxChars);
      return { ok: true, output: out };
    },
  });

  return { shareAgentContextTool, readAgentContextTool };
}
