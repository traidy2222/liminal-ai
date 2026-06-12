/**
 * Remote session framework — roles, join tokens, command ACL, URL builders.
 * Used by sidecar (host), remote-viewer (guest), and /remote slash command.
 */
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";

export type RemoteSessionRole = "owner" | "view" | "control";
export type RemoteSessionMode = "view" | "control";

export interface RemoteSessionGrant {
  sessionId: string;
  chatId: string;
  role: RemoteSessionMode;
  joinCode: string;
  joinToken: string;
  expiresAt: number;
  createdAt: number;
  cloud?: boolean;
}

export interface RemoteEnableResult {
  grant: RemoteSessionGrant;
  joinCode: string;
  joinToken: string;
  lanUrl: string | null;
  cloudUrl: string | null;
  expiresAt: number;
}

export interface RemoteSessionStatus {
  active: boolean;
  chatId: string | null;
  grants: Array<{
    joinCode: string;
    role: RemoteSessionMode;
    expiresAt: number;
    cloud?: boolean;
  }>;
  lanUrl: string | null;
  cloudUrl: string | null;
  guestCount: number;
}

const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Commands allowed for view-only remote guests. */
const VIEW_COMMANDS = new Set([
  "replay_transcript",
  "list_chats",
  "get_config",
  "ping",
  "remote_status",
]);

/** Additional commands for control-mode guests. */
const CONTROL_COMMANDS = new Set([
  ...VIEW_COMMANDS,
  "send_message",
  "abort",
  "resolve_approval",
  "resolve_ask_user",
]);

export function remoteSessionTtlMs(): number {
  const raw = process.env["LIMINAL_REMOTE_TTL_MS"]?.trim();
  const n = raw ? Number(raw) : 4 * 60 * 60 * 1000;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 7 * 24 * 60 * 60 * 1000) : 4 * 60 * 60 * 1000;
}

/** When unset, LAN remote is still enabled on /remote with default 0.0.0.0 bind. */
export function remoteBindHost(): string | null {
  const raw = process.env["LIMINAL_REMOTE_BIND_HOST"]?.trim();
  if (raw === "0" || raw?.toLowerCase() === "off" || raw?.toLowerCase() === "false") {
    return null;
  }
  return raw || "0.0.0.0";
}

export function defaultVireonRemoteJoinOrigin(): string {
  const raw = process.env["LIMINAL_REMOTE_CLOUD_ORIGIN"]?.trim();
  if (raw) return raw.replace(/\/+$/, "");
  return "https://www.vireondynamics.com";
}

export function mintJoinCode(length = 6): string {
  const n = Math.max(4, Math.min(length, 12));
  const bytes = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += JOIN_CODE_ALPHABET[bytes[i]! % JOIN_CODE_ALPHABET.length];
  }
  return out;
}

export function mintJoinToken(): string {
  return randomBytes(32).toString("hex");
}

export function mintRemoteSessionId(): string {
  return `rmt_${randomBytes(12).toString("hex")}`;
}

export function remoteCommandAllowed(
  role: RemoteSessionRole,
  commandName: string
): boolean {
  if (role === "owner") return true;
  const cmd = commandName.trim();
  if (!cmd) return false;
  if (role === "view") return VIEW_COMMANDS.has(cmd);
  if (role === "control") return CONTROL_COMMANDS.has(cmd);
  return false;
}

export function buildLanJoinUrl(opts: {
  host: string;
  port: number;
  joinCode: string;
}): string {
  const host = opts.host.includes(":") ? `[${opts.host}]` : opts.host;
  return `http://${host}:${opts.port}/remote/join?code=${encodeURIComponent(opts.joinCode)}`;
}

export function buildCloudJoinUrl(opts: { joinCode: string; origin?: string }): string {
  const base = (opts.origin ?? defaultVireonRemoteJoinOrigin()).replace(/\/+$/, "");
  return `${base}/remote/join/${encodeURIComponent(opts.joinCode)}`;
}

/** Pick the first non-internal IPv4 suitable for LAN join URLs. */
export function discoverLanIPv4(): string | null {
  const nets = networkInterfaces();
  const candidates: string[] = [];
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const addr = entry.address?.trim();
      if (!addr || addr.startsWith("169.254.")) continue;
      candidates.push(addr);
    }
  }
  return candidates[0] ?? null;
}

export function createRemoteSessionGrant(opts: {
  chatId: string;
  mode: RemoteSessionMode;
  cloud?: boolean;
  now?: number;
}): RemoteSessionGrant {
  const now = opts.now ?? Date.now();
  return {
    sessionId: mintRemoteSessionId(),
    chatId: opts.chatId,
    role: opts.mode,
    joinCode: mintJoinCode(),
    joinToken: mintJoinToken(),
    expiresAt: now + remoteSessionTtlMs(),
    createdAt: now,
    cloud: opts.cloud,
  };
}

export function grantIsExpired(grant: RemoteSessionGrant, now = Date.now()): boolean {
  return grant.expiresAt <= now;
}

export function formatRemoteStatusMessage(status: RemoteSessionStatus): string {
  if (!status.active || status.grants.length === 0) {
    return "Remote access is off for this chat.";
  }
  const lines: string[] = ["Remote session active:"];
  if (status.lanUrl) lines.push(`LAN: ${status.lanUrl}`);
  if (status.cloudUrl) lines.push(`Cloud: ${status.cloudUrl}`);
  for (const g of status.grants) {
    const exp = new Date(g.expiresAt).toLocaleString();
    lines.push(`  · ${g.joinCode} (${g.role}) expires ${exp}`);
  }
  if (status.guestCount > 0) {
    lines.push(`${status.guestCount} guest(s) connected.`);
  }
  lines.push("Use /remote off to revoke.");
  return lines.join("\n");
}

export type ParsedRemoteSlash =
  | { action: "enable"; mode: RemoteSessionMode; cloud: boolean }
  | { action: "disable" }
  | { action: "status" }
  | { action: "revoke"; joinCode: string };

/** Parse `/remote`, `/remote control`, `/remote cloud`, `/remote off`, etc. */
export function parseRemoteSlashCommand(text: string): ParsedRemoteSlash | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1).trim();
  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens[0]?.toLowerCase() !== "remote") return null;
  const sub = (tokens[1] ?? "").toLowerCase();
  if (!sub || sub === "view") {
    return { action: "enable", mode: "view", cloud: false };
  }
  if (sub === "control") {
    return { action: "enable", mode: "control", cloud: false };
  }
  if (sub === "cloud") {
    const mode = tokens[2]?.toLowerCase() === "control" ? "control" : "view";
    return { action: "enable", mode, cloud: true };
  }
  if (sub === "off" || sub === "disable" || sub === "stop") {
    return { action: "disable" };
  }
  if (sub === "status") {
    return { action: "status" };
  }
  if (sub === "revoke" && tokens[2]) {
    return { action: "revoke", joinCode: tokens[2]!.toUpperCase() };
  }
  return { action: "enable", mode: "view", cloud: false };
}
