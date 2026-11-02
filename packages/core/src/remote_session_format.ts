/** Browser-safe remote command parsing and presentation. */
import type { RemoteSessionMode, RemoteSessionStatus } from "./remote_session.js";

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
