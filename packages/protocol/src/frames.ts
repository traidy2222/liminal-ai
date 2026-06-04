import { PROTOCOL_VERSION } from "./version.js";
import type { ServerEventMap, ServerEventType } from "./events.js";
import type { ClientCommandMap, ClientCommandType } from "./commands.js";

/**
 * Wire framing. Every message in either direction is a single JSON object with
 * a `v` (protocol version), a `t` (tag discriminating event vs command), and a
 * typed payload. Frames are newline-free JSON; the transport (WebSocket message
 * boundaries) delimits them.
 */

/** Server → UI: a harness/transport event. */
export interface ServerFrame<T extends ServerEventType = ServerEventType> {
  v: number;
  t: "evt";
  event: T;
  data: ServerEventMap[T];
  /** Chat the event belongs to (omitted for global transport events like `hello`). */
  chatId?: string;
}

/** UI → server: a command awaiting a `command_result`. */
export interface ClientFrame<T extends ClientCommandType = ClientCommandType> {
  v: number;
  t: "cmd";
  /** UI-generated correlation id, echoed back in the `command_result` event. */
  id: string;
  command: T;
  data: ClientCommandMap[T];
}

export type AnyFrame = ServerFrame | ClientFrame;

/** Build a server event frame, stamping the current protocol version. */
export function serverFrame<T extends ServerEventType>(
  event: T,
  data: ServerEventMap[T],
  chatId?: string
): ServerFrame<T> {
  return chatId === undefined
    ? { v: PROTOCOL_VERSION, t: "evt", event, data }
    : { v: PROTOCOL_VERSION, t: "evt", event, data, chatId };
}

/** Build a client command frame, stamping the current protocol version. */
export function clientFrame<T extends ClientCommandType>(
  id: string,
  command: T,
  data: ClientCommandMap[T]
): ClientFrame<T> {
  return { v: PROTOCOL_VERSION, t: "cmd", id, command, data };
}

/** Type guard: is this parsed object a well-formed client command frame? */
export function isClientFrame(x: unknown): x is ClientFrame {
  if (typeof x !== "object" || x === null) return false;
  const f = x as Record<string, unknown>;
  return f["t"] === "cmd" && typeof f["id"] === "string" && typeof f["command"] === "string";
}

/** Type guard: is this parsed object a well-formed server event frame? */
export function isServerFrame(x: unknown): x is ServerFrame {
  if (typeof x !== "object" || x === null) return false;
  const f = x as Record<string, unknown>;
  return f["t"] === "evt" && typeof f["event"] === "string";
}

/** Parse a raw transport string into a frame, or `null` if malformed. */
export function parseFrame(raw: string): AnyFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (isClientFrame(parsed) || isServerFrame(parsed)) return parsed;
  return null;
}
