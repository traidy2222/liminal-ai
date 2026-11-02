import { readFile } from "node:fs/promises";
import { defineTool } from "../../shared/helpers.js";
import {
  commitContent,
  finishWithIntegrity,
  prepareFileWrite,
  promoteStagingFile,
  rejectIfLikelyTruncated,
  type FileWriteMode,
} from "./file_write_ops.js";
import { validateHtmlAppendChunk } from "./html_write_coherence.js";
import { rejectWorkspaceEmailStaging } from "./email_staging_guard.js";
import { takeFileWriteStreamManifest } from "@liminal/core";

function resolveMode(raw: unknown): FileWriteMode {
  return raw === "overwrite" || raw === "append" ? raw : "create";
}

export const writeFileTool = defineTool({
  name: "write_file",
  description:
    "WHAT: Write a whole file. Pick a mode:\n" +
    "  create (default) — make a NEW file; errors if it already exists.\n" +
    "  overwrite        — replace an existing file's entire contents (also creates it if missing).\n" +
    "  append           — add content to the end of a file (creates it if missing).\n" +
    "WHEN: You have the full file content, or a trailing chunk. For very large files, " +
    "call write_file once with mode=create, then mode=append for each follow-up section.\n" +
    "NOT WHEN: Making a targeted change to part of an existing file — use edit_file instead.\n" +
    "Existing files with real content: edit_file first; mode=overwrite needs confirm_overwrite: true after read_file.\n" +
    "ARGS: path; content; mode (create|overwrite|append); confirm_overwrite; optional expected_lines.",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`file:write:${args["path"] as string}`],
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write." },
      content: { type: "string", description: "Content to write." },
      mode: {
        type: "string",
        enum: ["create", "overwrite", "append"],
        description:
          "create (default): new file, errors if it exists. " +
          "overwrite: replace an existing file wholesale. " +
          "append: add to the end (creates the file if missing).",
      },
      confirm_overwrite: {
        type: "boolean",
        description:
          "Required with mode=overwrite on an existing non-trivial file (>8 lines or >400 bytes). " +
          "Call read_file first; prefer edit_file for partial changes.",
      },
      expected_lines: {
        type: "number",
        description: "Optional line count you expect in the final file (hints if output looks short).",
      },
      __harness_call_id: {
        type: "string",
        description: "Internal harness stream sink id (do not set).",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const pathArg = args["path"] as string;
    const mode = resolveMode(args["mode"]);
    const contentArg = typeof args["content"] === "string" ? args["content"] : "";
    const stagingErr = rejectWorkspaceEmailStaging(pathArg, contentArg);
    if (stagingErr) return { ok: false, error: stagingErr };
    const confirmOverwrite = args["confirm_overwrite"] === true;
    const callId = typeof args["__harness_call_id"] === "string" ? args["__harness_call_id"] : "";
    const streamManifest = callId ? takeFileWriteStreamManifest(callId) : undefined;
    const verb = mode === "append" ? "Appended" : "Wrote";

    if (streamManifest) {
      try {
        if (mode === "append") {
          try {
            const prev = await readFile(streamManifest.targetPath, "utf8");
            const staged = await readFile(streamManifest.stagingPath, "utf8");
            const htmlErr = validateHtmlAppendChunk(prev, staged, streamManifest.targetPath);
            if (htmlErr) return { ok: false, error: htmlErr };
          } catch {
            /* target or staging missing — promote will surface */
          }
        }
        const content = await promoteStagingFile(
          streamManifest.stagingPath,
          streamManifest.targetPath,
          mode,
          { confirmOverwrite }
        );
        const full =
          mode === "append"
            ? await readFile(streamManifest.targetPath, "utf8")
            : content;
        const { footer } = await finishWithIntegrity(streamManifest.targetPath, full);
        const preview = content.slice(0, 80).replace(/\n/g, "↵");
        return {
          ok: true,
          output:
            `${verb} ${content.length} chars to ${streamManifest.targetPath} (streamed)\n` +
            `${footer}\n` +
            `Preview: ${preview}${content.length > 80 ? "…" : ""}`,
        };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }

    const content = args["content"] as string;
    const truncErr = rejectIfLikelyTruncated(content);
    if (truncErr) return { ok: false, error: truncErr };

    const prep = await prepareFileWrite(pathArg, mode, { confirmOverwrite });
    if (!prep.ok) return { ok: false, error: prep.error };

    // Append mode: insert a newline separator if the existing file does not end
    // with one and the new content does not start with one.
    let payload = content;
    if (mode === "append") {
      try {
        const prev = await readFile(prep.resolvedPath, "utf8");
        if (prev.length > 0 && !prev.endsWith("\n") && !content.startsWith("\n")) {
          payload = "\n" + content;
        }
        const htmlErr = validateHtmlAppendChunk(prev, payload, prep.resolvedPath);
        if (htmlErr) return { ok: false, error: htmlErr };
      } catch {
        /* file does not exist yet — append creates it, no separator needed */
      }
    }

    try {
      await commitContent(prep.resolvedPath, payload, mode);
      const full =
        mode === "append" ? await readFile(prep.resolvedPath, "utf8") : payload;
      const { footer, report } = await finishWithIntegrity(prep.resolvedPath, full);
      const preview = content.slice(0, 80).replace(/\n/g, "↵");
      const expectedLines = args["expected_lines"];
      let lineHint = "";
      if (typeof expectedLines === "number" && expectedLines > 0 && report.lines < expectedLines) {
        lineHint = ` expected_lines=${expectedLines} (file has ${report.lines})`;
      }
      return {
        ok: true,
        output:
          `${verb} ${payload.length} chars to ${prep.resolvedPath}\n` +
          `${footer}${lineHint}\n` +
          `Preview: ${preview}${content.length > 80 ? "…" : ""}`,
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});
