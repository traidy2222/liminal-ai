import type { AgentEventMap } from "@liminal/core";
import {
  capWireToolOutput,
  toWireError,
  type WireAskUser,
  type WireError,
  type WireToolApproval,
} from "@liminal/protocol";

/**
 * Pure transforms from harness emitter payloads to their JSON-safe wire shapes.
 *
 * Only the three events that carry non-serializable data (`tool_approval` and
 * `ask_user` hold resolver callbacks; `error` holds an `Error`) need explicit
 * mapping. Every other harness event is already wire-safe and is forwarded
 * verbatim by {@link SessionBridge}.
 */

/** Strip the resolver, attach the one-time nonce the UI must echo back. */
export function wireToolApproval(
  payload: AgentEventMap["tool_approval"],
  approvalNonce: string
): WireToolApproval {
  return {
    callId: payload.callId,
    name: payload.name,
    args: payload.args,
    approvalTimeoutMs: payload.approvalTimeoutMs,
    approvalNonce,
  };
}

/** Strip the resolver from an ask_user prompt. */
export function wireAskUser(payload: AgentEventMap["ask_user"]): WireAskUser {
  return { prompt: payload.prompt };
}

/** Flatten the thrown error and cap nothing (errors are small). */
export function wireError(payload: AgentEventMap["error"]): WireError {
  return toWireError(payload.err);
}

/**
 * Forward a tool_result with its (possibly huge) output capped so the UI's
 * reducer never ingests multi-MB JSON in one frame. Shape is otherwise the
 * harness payload unchanged.
 */
export function wireToolResult(
  payload: AgentEventMap["tool_result"]
): AgentEventMap["tool_result"] {
  const r = payload.result;
  const capped = r.ok
    ? ({ ok: true as const, output: capWireToolOutput(r.output) })
    : ({ ok: false as const, error: capWireToolOutput(r.error) });
  return { ...payload, result: capped };
}
