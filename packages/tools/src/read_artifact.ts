/**
 * Retrieve full text archived by distill (AGENT_DISTILL).
 */
import { defineTool } from "./helpers.js";
import { readArtifactText } from "@liminal/core";

export const readArtifactTool = defineTool({
  name: "read_artifact",
  description:
    "WHAT: Read text saved under .agent_artifacts/<hash>.txt (from distilled tool outputs).\n" +
    "WHEN: You need the full file/web/shell output after seeing a distill hash.\n" +
    "ARGS: hash — hex hash from distill block; start_line, end_line — optional 1-based inclusive line slice.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      hash: { type: "string", description: "Artifact hash" },
      start_line: { type: "number", description: "First line (1-based, optional)" },
      end_line: { type: "number", description: "Last line inclusive (optional)" },
    },
    required: ["hash"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const hash = String(args["hash"] ?? "").trim();
    if (!hash) return { ok: false, error: "hash required" };
    const sl = args["start_line"] as number | undefined;
    const el = args["end_line"] as number | undefined;
    const range =
      sl !== undefined && el !== undefined
        ? { startLine: Math.max(1, sl), endLine: Math.max(sl, el) }
        : sl !== undefined
          ? { startLine: Math.max(1, sl), endLine: 1_000_000 }
          : undefined;
    const r = await readArtifactText(hash, range);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, output: r.text.slice(0, 120_000) };
  },
});
