/**
 * Retrieve full text archived by distill (AGENT_DISTILL).
 */
import { defineTool } from "../../shared/helpers.js";
import {
  readArtifactText,
  readArtifactJsonView,
  isValidArtifactHash,
  type ToolResult,
} from "@liminal/core";

const READ_ARTIFACT_WALL_MS = 25_000;

export const readArtifactTool = defineTool({
  name: "read_artifact",
  description:
    "WHAT: Read text saved under .agent_artifacts/<hash>.txt (from AGENT_DISTILL=1 or AGENT_TOOL_BODY_ELIDE=1).\n" +
    "WHEN: You need full archived tool output after distill — for web_fetch/run_shell bodies, not vault notes (use vault_read).\n" +
    "NOT WHEN: The source was read_file — prefer read_file(path) with offset/limit; the file still exists on disk. Do not activate memory_advanced just for this.\n" +
    "Requires memory_advanced family when lazy tools are on. If the hash is missing, use inline web_fetch output instead.\n" +
    "ARGS: hash — hex hash from distill block. Text view (default): start_line/end_line, 1-based inclusive, max 8000 lines. For archived JSON, explicitly use view=keys to discover the actual root/child keys or view=value with json_pointer (RFC6901, e.g. /result/procedures). Arrays default 20/max 200 items; strings default 8000/max 20000 Unicode code points. JSON pages remain valid and <=24000 UTF8 bytes; follow next_offset or explicit drill_pointer when an item is too large. Do not line-slice minified JSON or invent a result wrapper.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      hash: { type: "string", description: "Artifact hash" },
      start_line: {
        type: "number",
        description: "First line (1-based, optional)",
      },
      end_line: {
        type: "number",
        description: "Last line inclusive (optional)",
      },
      view: {
        type: "string",
        enum: ["text", "keys", "value"],
        description:
          "Explicit JSON keys/value mode or existing text mode (default).",
      },
      json_pointer: {
        type: "string",
        description:
          "Plain RFC6901 pointer; empty string selects the actual JSON root. Defaults to view=value when supplied without view.",
      },
      offset: {
        type: "integer",
        minimum: 0,
        description:
          "Zero-based JSON item/key offset or Unicode code-point offset for strings.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 20000,
        description:
          "Arrays/keys max 200 (default 20/64); strings max 20000 Unicode code points (default 8000), also bounded by serialized budget.",
      },
    },
    required: ["hash"],
    additionalProperties: false,
  },
  handler: async (args, _emit, _harness, context) => {
    const hash = String(args["hash"] ?? "").trim();
    if (!isValidArtifactHash(hash))
      return {
        ok: false,
        error: "read_artifact: invalid hash; expected 1..128 hex characters",
      };
    if (context?.signal?.aborted)
      return { ok: false, error: "read_artifact: turn stopped" };
    const view = args.view ?? (args.json_pointer !== undefined || args.offset !== undefined || args.limit !== undefined ? "value" : "text");
    if (view !== "text" && view !== "keys" && view !== "value")
      return {
        ok: false,
        error: "read_artifact: view must be text, keys or value",
      };
    const jsonMode = view === "keys" || view === "value";
    if (
      !jsonMode &&
      (args.json_pointer !== undefined ||
        args.offset !== undefined ||
        args.limit !== undefined)
    )
      return {
        ok: false,
        error:
          "read_artifact: JSON pointer/pagination requires explicit view=keys or value",
      };
    if (
      jsonMode &&
      (args.start_line !== undefined || args.end_line !== undefined)
    )
      return {
        ok: false,
        error:
          "read_artifact: JSON selection cannot be combined with text line slicing",
      };
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
    const stop = () => budget.abort(context?.signal?.reason);
    context?.signal?.addEventListener("abort", stop, { once: true });
    try {
      const reading: Promise<ToolResult> = jsonMode
        ? readArtifactJsonView(hash, {
            view,
            jsonPointer: args.json_pointer as string | undefined,
            offset: args.offset as number | undefined,
            limit: args.limit as number | undefined,
            signal: budget.signal,
          })
        : readArtifactText(hash, range).then((result) =>
            result.ok
              ? { ok: true, output: result.text.slice(0, 120_000) }
              : result,
          );
      const r = await Promise.race([
        reading,
        new Promise<{ ok: false; error: string }>((resolve) => {
          budget.signal.addEventListener(
            "abort",
            () =>
              resolve({
                ok: false,
                error: context?.signal?.aborted
                  ? "read_artifact: turn stopped"
                  : `read_artifact: exceeded wall time ${READ_ARTIFACT_WALL_MS}ms`,
              }),
            { once: true },
          );
        }),
      ]);
      if (!r.ok) return { ok: false, error: r.error };
      return r;
    } finally {
      clearTimeout(kill);
      context?.signal?.removeEventListener("abort", stop);
    }
  },
});
