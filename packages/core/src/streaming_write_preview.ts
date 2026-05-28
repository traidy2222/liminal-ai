/**
 * Live preview of streaming tool-call payloads (files, vault, memory writes).
 * Used by web/TUI to show in-progress content while tool_delta arrives.
 */
import { decodePartialJsonStringField, tryExtractJsonStringField } from "./tool_arg_content_stream.js";

export interface StreamingWriteToolSpec {
  /** String fields to show as they stream (first match wins). */
  contentFields: string[];
  /** Label fields tried in order (path, title, key, …). */
  labelFields: string[];
  /** When no string field is found yet, show a tail of raw JSON args. */
  rawArgsFallback?: boolean;
}

/** Tools that write durable content — keep in sync with packages/tools registrations. */
export const STREAMING_WRITE_TOOL_SPECS: Readonly<Record<string, StreamingWriteToolSpec>> = {
  think: { contentFields: ["content"], labelFields: [] },
  reason: { contentFields: ["inference"], labelFields: [] },
  plan: { contentFields: [], labelFields: [], rawArgsFallback: true },
  breakdown: { contentFields: ["goal"], labelFields: [], rawArgsFallback: true },
  write_file: { contentFields: ["content"], labelFields: ["path"] },
  edit_file: { contentFields: ["diff"], labelFields: ["path"] },
  vault_write: { contentFields: ["content"], labelFields: ["title"] },
  remember: { contentFields: ["value"], labelFields: ["key"] },
  append_persona_living: { contentFields: ["note"], labelFields: [] },
  execute_code: { contentFields: ["code"], labelFields: [] },
  run_shell: { contentFields: ["command"], labelFields: [] },
  run_background: { contentFields: ["command"], labelFields: [] },
};

export interface StreamingWritePreview {
  toolName: string;
  field: string | null;
  label: string | null;
  content: string;
  charCount: number;
  lineCount: number;
  /** True when the JSON string field is still open (provider still streaming). */
  incomplete: boolean;
  /** Truncated raw args when contentFields empty / not started. */
  rawArgsTail: string | null;
}

export function isStreamingWriteTool(toolName: string): boolean {
  return Object.prototype.hasOwnProperty.call(STREAMING_WRITE_TOOL_SPECS, toolName);
}

/** Harness reasoning tools that stream visible content in tool args (not durable file writes). */
export function isStreamingReasoningTool(toolName: string): boolean {
  return toolName === "think" || toolName === "reason" || toolName === "plan";
}

function resolveStreamingLabel(argsJson: string, labelFields: string[]): string | null {
  for (const lf of labelFields) {
    const closed = tryExtractJsonStringField(argsJson, lf);
    if (closed) return closed;
    const partial = decodePartialJsonStringField(argsJson, lf);
    if (partial.value.length > 0) return partial.value;
  }
  return null;
}

export function extractStreamingWritePreview(
  toolName: string,
  argsJson: string,
  opts?: { tailLines?: number; maxChars?: number }
): StreamingWritePreview | null {
  const spec = STREAMING_WRITE_TOOL_SPECS[toolName];
  if (!spec) return null;

  const tailLines = opts?.tailLines ?? 12;
  const maxChars = opts?.maxChars ?? 24_000;
  const raw = argsJson ?? "";

  const label = raw.length > 0 ? resolveStreamingLabel(raw, spec.labelFields) : null;

  if (raw.length === 0) {
    return {
      toolName,
      field: spec.contentFields[0] ?? null,
      label: null,
      content: "",
      charCount: 0,
      lineCount: 0,
      incomplete: true,
      rawArgsTail: null,
    };
  }

  for (const cf of spec.contentFields) {
    const partial = decodePartialJsonStringField(raw, cf);
    if (partial.value.length > 0 || partial.started) {
      const full = partial.value.slice(0, maxChars);
      const lines = full.split("\n");
      const tail = lines.slice(-tailLines);
      return {
        toolName,
        field: cf,
        label,
        content: tail.join("\n"),
        charCount: partial.value.length,
        lineCount: lines.length,
        incomplete: !partial.closed,
        rawArgsTail: null,
      };
    }
  }

  if (spec.rawArgsFallback || spec.contentFields.length === 0) {
    const tail = raw.slice(-Math.min(800, raw.length));
    return {
      toolName,
      field: null,
      label,
      content: "",
      charCount: 0,
      lineCount: 0,
      incomplete: true,
      rawArgsTail: tail,
    };
  }

  return {
    toolName,
    field: spec.contentFields[0] ?? null,
    label,
    content: "",
    charCount: 0,
    lineCount: 0,
    incomplete: true,
    rawArgsTail: raw.slice(-Math.min(800, raw.length)),
  };
}
