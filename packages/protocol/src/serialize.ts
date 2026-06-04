import type { WireError } from "./events.js";

/** Flatten any thrown value into the JSON-safe {@link WireError} wire shape. */
export function toWireError(err: unknown): WireError {
  if (err instanceof Error) {
    return {
      message: err.message,
      name: err.name,
      ...(err.stack ? { stack: err.stack } : {}),
    };
  }
  return { message: typeof err === "string" ? err : String(err) };
}

/**
 * Cap an oversized tool_result body before it crosses the wire so the UI's
 * event reducer never has to ingest multi-MB JSON in a single frame. Mirrors
 * the web bridge's SSE cap; kept here so every transport applies it uniformly.
 */
export const WIRE_TOOL_RESULT_MAX_CHARS = 48_000;

export function capWireToolOutput(
  text: string,
  max: number = WIRE_TOOL_RESULT_MAX_CHARS
): string {
  if (text.length <= max) return text;
  return (
    text.slice(0, max) +
    `\n\n[wire: output truncated after ${max} characters for UI performance]`
  );
}
