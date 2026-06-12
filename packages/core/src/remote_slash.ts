import { formatRemoteStatusMessage, type ParsedRemoteSlash } from "./remote_session.js";

export type RemoteSlashCommandResult =
  | { action: "enable"; chatId: string; mode: "view" | "control"; cloud: boolean }
  | { action: "disable"; chatId?: string }
  | { action: "status"; chatId?: string }
  | { action: "revoke"; joinCode: string };

export function remoteSlashToCommand(
  remote: ParsedRemoteSlash,
  activeChatId: string
): RemoteSlashCommandResult {
  switch (remote.action) {
    case "enable":
      return {
        action: "enable",
        chatId: activeChatId,
        mode: remote.mode,
        cloud: remote.cloud,
      };
    case "disable":
      return { action: "disable", chatId: activeChatId };
    case "status":
      return { action: "status", chatId: activeChatId };
    case "revoke":
      return { action: "revoke", joinCode: remote.joinCode };
  }
}

export function formatRemoteEnableMessage(data: {
  joinCode: string;
  lanUrl?: string | null;
  cloudUrl?: string | null;
  expiresAt: number;
  mode: string;
}): string {
  const lines = [
    `Remote ${data.mode} link ready (code ${data.joinCode}).`,
    `Expires: ${new Date(data.expiresAt).toLocaleString()}`,
  ];
  if (data.lanUrl) lines.push(`LAN: ${data.lanUrl}`);
  if (data.cloudUrl) lines.push(`Cloud: ${data.cloudUrl}`);
  if (!data.lanUrl && !data.cloudUrl) {
    lines.push("No LAN URL — check Wi‑Fi and LIMINAL_REMOTE_BIND_HOST.");
  }
  lines.push("Use /remote off to revoke.");
  return lines.join("\n");
}

export { formatRemoteStatusMessage };
