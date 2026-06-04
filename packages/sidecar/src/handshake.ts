import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { PROTOCOL_VERSION } from "@liminal/protocol";

/**
 * Sidecar discovery handshake.
 *
 * `liminald` binds a WebSocket server to 127.0.0.1 on an ephemeral port and
 * writes the chosen port + a per-launch auth token to a well-known file. The
 * native UI reads that file to learn where to connect and how to authenticate.
 *
 * The token gates the only real risk of a loopback socket: another local
 * process connecting. A connection must present the token (WS subprotocol or
 * first frame) or it is closed immediately.
 */

export interface HandshakeRecord {
  protocolVersion: number;
  /** TCP port the WS server bound to on 127.0.0.1. */
  port: number;
  /** Per-launch bearer token the UI must present to attach. */
  token: string;
  /** Sidecar process id — UI can verify liveness / kill on quit. */
  pid: number;
  /** ms epoch the sidecar came up. */
  startedAt: number;
}

/** Directory holding all Liminal runtime state. `~/.liminal`. */
export function liminalHome(): string {
  return process.env["LIMINAL_HOME"]?.trim() || join(homedir(), ".liminal");
}

/** Absolute path of the handshake file the UI polls for. */
export function handshakePath(): string {
  return join(liminalHome(), "sidecar.json");
}

/** Mint a fresh per-launch token (256-bit, hex). */
export function mintToken(): string {
  return randomBytes(32).toString("hex");
}

/** Persist the handshake record with owner-only permissions. */
export async function writeHandshake(
  record: Omit<HandshakeRecord, "protocolVersion" | "startedAt">
): Promise<HandshakeRecord> {
  const full: HandshakeRecord = {
    protocolVersion: PROTOCOL_VERSION,
    startedAt: Date.now(),
    ...record,
  };
  const dir = liminalHome();
  await mkdir(dir, { recursive: true });
  // mode 0600 — readable only by the owner (best-effort on Windows).
  await writeFile(handshakePath(), JSON.stringify(full, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return full;
}

/** Remove the handshake file (called on clean shutdown). */
export async function clearHandshake(): Promise<void> {
  await rm(handshakePath(), { force: true }).catch(() => undefined);
}
