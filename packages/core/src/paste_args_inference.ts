/**
 * PASTE — speculative-args inference.
 *
 * The pattern miner predicts the next *tool name* but not its arguments.
 * Without args, we can't dispatch speculatively. This module bridges that gap
 * for a small whitelist of predictable patterns where the args can be
 * inferred from prior tool output in the current send.
 *
 * Today: web_fetch URL inferred from the most recent successful web_search.
 *
 * Returning `null` means "we know the tool name but can't safely build args" —
 * the scheduler should skip the speculation rather than guess.
 */
import type { SessionToolIndex } from "./session_tool_index.js";

export interface InferredSpeculationArgs {
  args: Record<string, unknown>;
  /** Where the args came from — used for telemetry. */
  source: string;
}

/** Plausible URL regex; intentionally conservative (no trailing punctuation, no spaces). */
const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

function extractTopUrlFromSearch(output: string): string | null {
  // First, try a JSON-ish "url" field. Many search-tool outputs are JSON-shaped.
  const jsonUrl = output.match(/"url"\s*:\s*"(https?:\/\/[^"]+)"/);
  if (jsonUrl && jsonUrl[1]) return jsonUrl[1];
  // Fallback: first raw URL in the output.
  const matches = output.match(URL_RE);
  if (matches && matches.length > 0) {
    return matches[0]!.replace(/[.,;:!?]+$/, "");
  }
  return null;
}

/**
 * Try to build speculative args for `predictedTool` from this turn's
 * tool-output index. Returns null when we can't infer args safely.
 */
export function inferSpeculationArgs(
  predictedTool: string,
  index: SessionToolIndex
): InferredSpeculationArgs | null {
  if (predictedTool === "web_fetch") {
    const latestSearch = index.getLatest("web_search");
    if (!latestSearch || !latestSearch.ok) return null;
    const url = extractTopUrlFromSearch(latestSearch.output);
    if (!url) return null;
    return {
      args: { url },
      source: `web_search(${latestSearch.callId})`,
    };
  }
  // Future: read_file_with_imports from a path mentioned in grep_file output,
  // file_metadata from a write_file path, etc. Each case must be high-confidence
  // since wrong-args speculation wastes the budget.
  return null;
}
