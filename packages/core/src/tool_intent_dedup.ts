/**
 * Generic per-send intent dedup: tools may declare `intentDedupArgs` so the harness
 * treats calls with the same tool + those arg fields as one intent (ignoring large
 * or tweakable payload fields like body_html).
 */
import { stableArgsJsonKey } from "./json_stable.js";
import { tryParseToolArgs } from "./file_write_resume.js";

type IntentCompleteFn = (args: Record<string, unknown>, output: string) => boolean;

export function evaluateIntentPayloadComplete(
  intentPayloadComplete: IntentCompleteFn | undefined,
  argsJson: string,
  output: string
): boolean {
  if (!intentPayloadComplete) return true;
  const parsed = tryParseToolArgs(argsJson);
  if (!parsed.ok) return false;
  try {
    return intentPayloadComplete(parsed.args, output);
  } catch {
    return false;
  }
}

export interface IntentResultRecord {
  toolName: string;
  intentKey: string;
  output: string;
  summary: string;
  payloadComplete: boolean;
}

function normalizeIntentPart(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((e) => String(e).trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join(",");
  }
  return String(value).trim().toLowerCase();
}

function readIntentArg(args: Record<string, unknown>, field: string): unknown {
  if (field in args) return args[field];
  if (field === "thread_id" && "threadId" in args) return args["threadId"];
  if (field === "threadId" && "thread_id" in args) return args["thread_id"];
  return undefined;
}

/** Stable dedup key for batch + cross-round reuse within one send(). */
export function buildToolIntentDedupKey(
  toolName: string,
  argsJson: string,
  intentFields: string[] | undefined
): string {
  if (!intentFields || intentFields.length === 0) {
    return `${toolName}:${stableArgsJsonKey(argsJson)}`;
  }
  const parsed = tryParseToolArgs(argsJson);
  if (!parsed.ok) return `${toolName}:${stableArgsJsonKey(argsJson)}`;
  const parts: string[] = [];
  for (const field of intentFields) {
    const part = normalizeIntentPart(readIntentArg(parsed.args, field));
    if (!part) return `${toolName}:${stableArgsJsonKey(argsJson)}`;
    parts.push(part);
  }
  return `${toolName}:${parts.join("|")}`;
}

export function formatIntentSummary(
  toolName: string,
  argsJson: string,
  intentFields: string[] | undefined
): string {
  if (!intentFields?.length) return toolName;
  const parsed = tryParseToolArgs(argsJson);
  if (!parsed.ok) return toolName;
  const bits = intentFields
    .map((f) => {
      const v = readIntentArg(parsed.args, f);
      const n = normalizeIntentPart(v);
      return n ? `${f}=${n}` : "";
    })
    .filter(Boolean);
  return bits.length > 0 ? `${toolName} (${bits.join(", ")})` : toolName;
}

export function intentDedupReuseOutput(record: IntentResultRecord): string {
  return (
    `${record.output}\n` +
    `[dedup] Reused prior successful ${record.toolName} for the same intent this turn (${record.summary}). ` +
    "Payload was complete — do not repeat. Continue with the next step from the user's request or use prior tool results."
  );
}

export function buildIntentProgressBlock(records: IntentResultRecord[]): string {
  if (records.length === 0) return "";
  const lines = records.map((r) => `- ${r.summary}`);
  return (
    "[TOOL PROGRESS] Completed this turn:\n" +
    lines.join("\n") +
    "\nNext: continue with the **next step** from the user's request — do not redo the items above."
  );
}
