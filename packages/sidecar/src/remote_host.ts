import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket } from "ws";
import {
  buildCloudJoinUrl,
  buildLanJoinUrl,
  createRemoteSessionGrant,
  discoverLanIPv4,
  grantIsExpired,
  remoteBindHost,
  type RemoteEnableResult,
  type RemoteSessionGrant,
  type RemoteSessionMode,
  type RemoteSessionStatus,
} from "@liminal/core";
import { tryHandleRemoteJoinRequest } from "./remote_join_handler.js";

export type RemoteClientRole = "owner" | "view" | "control";

export interface RemoteClientMeta {
  role: RemoteClientRole;
  chatId?: string;
}

export type RemoteSessionEmitter = (status: RemoteSessionStatus) => void;

export type RemoteLanUpgradeHandler = (
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
) => void;

export class RemoteHostManager {
  private readonly byToken = new Map<string, RemoteSessionGrant>();
  private readonly byCode = new Map<string, string>();
  private readonly guests = new Set<WebSocket>();
  private lanServer: HttpServer | null = null;
  private lanPort: number | null = null;
  private primaryPort = 0;
  private cloudUrl: string | null = null;
  private onLanUpgrade: RemoteLanUpgradeHandler | null = null;

  constructor(private readonly emitStatus: RemoteSessionEmitter) {}

  setLanUpgradeHandler(handler: RemoteLanUpgradeHandler): void {
    this.onLanUpgrade = handler;
  }

  setPrimaryPort(port: number): void {
    this.primaryPort = port;
  }

  getLanPort(): number | null {
    return this.lanPort ?? this.primaryPort ?? null;
  }

  attachGuest(ws: WebSocket): void {
    this.guests.add(ws);
    ws.on("close", () => {
      this.guests.delete(ws);
      this.emitCurrentStatus();
    });
    ws.on("error", () => this.guests.delete(ws));
    this.emitCurrentStatus();
  }

  detachGuest(ws: WebSocket): void {
    this.guests.delete(ws);
    this.emitCurrentStatus();
  }

  guestCount(): number {
    return this.guests.size;
  }

  resolveJoinToken(presented: string): { role: RemoteClientRole; chatId: string } | null {
    const token = presented.trim();
    if (!token) return null;
    const grant = this.byToken.get(token);
    if (!grant || grantIsExpired(grant)) {
      this.revokeToken(token);
      return null;
    }
    return { role: grant.role, chatId: grant.chatId };
  }

  resolveJoinCode(code: string): RemoteSessionGrant | null {
    const key = code.trim().toUpperCase();
    const token = this.byCode.get(key);
    if (!token) return null;
    const grant = this.byToken.get(token);
    if (!grant || grantIsExpired(grant)) {
      this.revokeToken(token);
      return null;
    }
    return grant;
  }

  async enable(opts: {
    chatId: string;
    mode: RemoteSessionMode;
    cloud?: boolean;
    cloudUrl?: string | null;
  }): Promise<RemoteEnableResult> {
    await this.ensureLanServer();
    const grant = createRemoteSessionGrant({
      chatId: opts.chatId,
      mode: opts.mode,
      cloud: opts.cloud,
    });
    this.byToken.set(grant.joinToken, grant);
    this.byCode.set(grant.joinCode.toUpperCase(), grant.joinToken);
    if (opts.cloudUrl) this.cloudUrl = opts.cloudUrl;
    else if (opts.cloud) this.cloudUrl = buildCloudJoinUrl({ joinCode: grant.joinCode });

    const lanIp = discoverLanIPv4();
    const port = this.lanPort ?? this.primaryPort;
    const lanUrl =
      lanIp && port
        ? buildLanJoinUrl({ host: lanIp, port, joinCode: grant.joinCode })
        : null;

    const result: RemoteEnableResult = {
      grant,
      joinCode: grant.joinCode,
      joinToken: grant.joinToken,
      lanUrl,
      cloudUrl: this.cloudUrl,
      expiresAt: grant.expiresAt,
    };
    this.emitCurrentStatus(grant.chatId);
    return result;
  }

  disable(chatId?: string): number {
    let removed = 0;
    for (const [token, grant] of [...this.byToken.entries()]) {
      if (chatId && grant.chatId !== chatId) continue;
      this.revokeToken(token);
      removed++;
    }
    if (removed === 0 && !chatId) {
      this.byToken.clear();
      this.byCode.clear();
    }
    this.cloudUrl = null;
    this.stopLanServerIfIdle();
    this.emitCurrentStatus(chatId ?? null);
    return removed;
  }

  revokeCode(joinCode: string): boolean {
    const token = this.byCode.get(joinCode.trim().toUpperCase());
    if (!token) return false;
    this.revokeToken(token);
    this.emitCurrentStatus();
    this.stopLanServerIfIdle();
    return true;
  }

  status(chatId?: string): RemoteSessionStatus {
    const grants = [...this.byToken.values()].filter((g) => {
      if (grantIsExpired(g)) return false;
      if (chatId && g.chatId !== chatId) return false;
      return true;
    });
    const active = grants.length > 0;
    const first = grants[0];
    const lanIp = discoverLanIPv4();
    const port = this.lanPort ?? this.primaryPort;
    const lanUrl =
      active && lanIp && port && first
        ? buildLanJoinUrl({ host: lanIp, port, joinCode: first.joinCode })
        : null;
    return {
      active,
      chatId: first?.chatId ?? chatId ?? null,
      grants: grants.map((g) => ({
        joinCode: g.joinCode,
        role: g.role,
        expiresAt: g.expiresAt,
        cloud: g.cloud,
      })),
      lanUrl,
      cloudUrl: active ? this.cloudUrl : null,
      guestCount: this.guests.size,
    };
  }

  private revokeToken(token: string): void {
    const grant = this.byToken.get(token);
    if (grant) this.byCode.delete(grant.joinCode.toUpperCase());
    this.byToken.delete(token);
  }

  private emitCurrentStatus(chatId?: string | null): void {
    this.emitStatus(this.status(chatId ?? undefined));
  }

  private async ensureLanServer(): Promise<void> {
    const bind = remoteBindHost();
    if (!bind || this.lanServer) return;

    this.lanServer = createServer((req, res) => {
      if (this.handleLanHttp(req, res)) return;
      res.writeHead(404);
      res.end();
    });

    this.lanServer.on("upgrade", (req, socket, head) => {
      if (this.onLanUpgrade) {
        this.onLanUpgrade(req, socket, head);
        return;
      }
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
    });

    await new Promise<void>((resolve, reject) => {
      this.lanServer!.once("error", reject);
      this.lanServer!.listen(0, bind, () => {
        const addr = this.lanServer!.address();
        if (addr && typeof addr === "object") this.lanPort = addr.port;
        resolve();
      });
    });
  }

  handleLanHttp(req: IncomingMessage, res: import("node:http").ServerResponse): boolean {
    return tryHandleRemoteJoinRequest(req, res, {
      resolveCode: (code) => this.resolveJoinCode(code),
      loopbackPort: this.primaryPort,
      lanPort: this.lanPort ?? this.primaryPort,
    });
  }

  private stopLanServerIfIdle(): void {
    if (this.byToken.size > 0 || !this.lanServer) return;
    this.lanServer.close();
    this.lanServer = null;
    this.lanPort = null;
  }

  dispose(): void {
    this.byToken.clear();
    this.byCode.clear();
    this.guests.clear();
    if (this.lanServer) {
      this.lanServer.close();
      this.lanServer = null;
    }
  }
}
