/**
 * Liminal native protocol — wire version.
 *
 * The sidecar and the native UI handshake on this number in the `hello` event.
 * Bump it whenever a frame/event/command shape changes in a backwards-incompatible
 * way so an older client can refuse to attach rather than mis-decode.
 */
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;
