/**
 * Retrieve full text archived by distill (AGENT_DISTILL).
 */
import { defineTool } from "../../shared/helpers.js";
import { effectiveHarnessEnvRaw, readArtifactText } from "@liminal/core";

const READ_ARTIFACT_WALL_MS = 25_000;

export const readArtifactTool = defineTool({
  name: "read_artifact",
  description:
    "WHAT: Read text saved under .agent_artifacts/<hash>.txt (from AGENT_DISTILL=1 or AGENT_TOOL_BODY_ELIDE=1).\n" +
    "WHEN: You need full archived tool output after distill — for web_fetch/run_shell bodies, not vault notes (use vault_read).\n" +
    "NOT WHEN: The source was read_file — prefer read_file(path) with offset/limit; the file still exists on disk. Do not activate memory_advanced just for this.\n" +
    "Requires memory_advanced family when lazy tools are on. If the hash is missing, use inline web_fetch output instead.\n" +
    "ARGS: hash — hex hash from distill block; start_line, end_line — optional 1-based inclusive line slice (max 8000 lines per call).",
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
    if (
      effectiveHarnessEnvRaw("AGENT_DISTILL") !== "1" &&
      effectiveHarnessEnvRaw("AGENT_TOOL_BODY_ELIDE") !== "1"
    ) {
      return {
        ok: false,
        error:
          "read_artifact: no artifact store active (AGENT_DISTILL and AGENT_TOOL_BODY_ELIDE are off). " +
          "Use the inline tool output from this turn or call web_fetch/read_file again.",
      };
    }
    const sl = args["start_line"] as number | undefined;
    const el = args["end_line"] as number | undefined;
    const range =
      sl !== undefined && el !== undefined
        ? { startLine: Math.max(1, sl), endLine: Math.max(sl, el) }
        : sl !== undefined
          ? { startLine: Math.max(1, sl), endLine: sl + 7999 }
          : undefined;
    const budget = new AbortController();
    const kill = setTimeout(() => budget.abort(), READ_ARTIFACT_WALL_MS);
    try {
      const r = await Promise.race([
        readArtifactText(hash, range),
        new Promise<{ ok: false; error: string }>((resolve) => {
          budget.signal.addEventListener(
            "abort",
            () =>
              resolve({
                ok: false,
                error: `read_artifact: exceeded wall time ${READ_ARTIFACT_WALL_MS}ms`,
              }),
            { once: true }
          );
        }),
      ]);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, output: r.text.slice(0, 120_000) };
    } finally {
      clearTimeout(kill);
    }
  },
});
