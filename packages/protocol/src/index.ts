/**
 * @liminal/protocol — the frozen, typed wire contract between the Liminal
 * harness sidecar (`liminald`) and the native (Flutter) desktop UI.
 *
 * This package is the single source of truth for what flows across the IPC
 * boundary. The server-event surface is *derived* from core's `AgentEventMap`,
 * so a harness payload change cannot silently desync the UI — it surfaces as a
 * type error in the sidecar's event mapper.
 */
export { PROTOCOL_VERSION, type ProtocolVersion } from "./version.js";

export type {
  WireError,
  WireToolApproval,
  WireAskUser,
  WireAgentEventMap,
  TransportEventMap,
  ServerEventMap,
  ServerEventType,
  ServerEventData,
  ChatSummary,
  WireAppConfig,
} from "./events.js";

export type {
  ClientCommandMap,
  ClientCommandType,
  ClientCommandData,
  WireChatAttachment,
  WireImageAttachment,
} from "./commands.js";

export {
  serverFrame,
  clientFrame,
  isClientFrame,
  isServerFrame,
  parseFrame,
  type ServerFrame,
  type ClientFrame,
  type AnyFrame,
} from "./frames.js";

export { toWireError, capWireToolOutput, WIRE_TOOL_RESULT_MAX_CHARS } from "./serialize.js";
