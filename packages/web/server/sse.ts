import type { Response } from "express";
import type { Request } from "express";

interface SSEClient {
  id: string;
  res: Response;
}

interface SSEEvent {
  id: number;
  eventName: string;
  data: unknown;
  chatId: string;
}

export class SSEManager {
  private clients = new Map<string, SSEClient>();
  private idCounter = 0;
  private eventCounter = 0;
  /** Per-chat event ring buffers — prevents cross-chat secret leakage on replay. */
  private readonly histories = new Map<string, SSEEvent[]>();
  private readonly historyLimit = 2000;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private activeChatId = "";

  setActiveChatId(chatId: string): void {
    this.activeChatId = chatId;
  }

  clearHistory(chatId?: string): void {
    if (chatId) {
      this.histories.delete(chatId);
      return;
    }
    if (this.activeChatId) {
      this.histories.delete(this.activeChatId);
    }
  }

  add(req: Request, res: Response, chatId: string): string {
    const id = String(++this.idCounter);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(`retry: 1000\n\n`);

    this.clients.set(id, { id, res });
    this.ensureHeartbeat();

    res.on("close", () => {
      this.clients.delete(id);
      if (this.clients.size === 0 && this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    });
    res.on("error", () => {
      this.clients.delete(id);
    });

    const lastEventIdRaw =
      req.header("last-event-id") ?? (req.query["lastEventId"] as string | undefined);
    const lastEventId = lastEventIdRaw ? Number.parseInt(lastEventIdRaw, 10) : NaN;
    const hasLastEventId = Number.isFinite(lastEventId);
    const replayHistory = req.query["replayHistory"] === "1";

    const connectedCursor = this.eventCounter;
    res.write(`event: connected\ndata: ${JSON.stringify({ id, cursor: connectedCursor, chatId })}\n\n`);

    const history = this.histories.get(chatId) ?? [];

    if (replayHistory && history.length > 0) {
      this.replayHistoryToClient(res, history);
    } else if (hasLastEventId) {
      const staleCursor = (lastEventId as number) > connectedCursor;
      const tail = history.filter((evt) => staleCursor || evt.id > (lastEventId as number));
      this.replayHistoryToClient(res, tail);
    }

    return id;
  }

  send(eventName: string, data: unknown, chatId?: string): void {
    const cid = chatId ?? this.activeChatId;
    if (!cid) {
      console.warn(`[SSE] send("${eventName}") skipped — no active chatId`);
      return;
    }

    const id = ++this.eventCounter;
    let wireName = eventName;
    let wireData: unknown = data;
    try {
      JSON.stringify(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SSE] non-serializable payload for event "${eventName}":`, msg);
      wireName = "error";
      wireData = {
        message: `Server could not encode SSE event "${eventName}" (${msg.slice(0, 400)}).`,
      };
    }

    let history = this.histories.get(cid);
    if (!history) {
      history = [];
      this.histories.set(cid, history);
    }
    history.push({ id, eventName: wireName, data: wireData, chatId: cid });
    if (history.length > this.historyLimit) {
      history.splice(0, history.length - this.historyLimit);
    }

    let payload: string;
    try {
      payload = this.serialize(id, wireName, wireData);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SSE] serialize failed after coercion:`, msg);
      payload = this.serialize(id, "error", {
        message: `SSE serialize failed: ${msg.slice(0, 400)}`,
      });
    }
    const dead: string[] = [];
    for (const client of this.clients.values()) {
      try {
        client.res.write(payload);
      } catch {
        dead.push(client.id);
      }
    }
    for (const clientId of dead) {
      this.dropClient(clientId);
    }
  }

  private dropClient(id: string): void {
    const client = this.clients.get(id);
    this.clients.delete(id);
    if (client) {
      try {
        if (!client.res.writableEnded) client.res.end();
      } catch {
        /* socket already torn down */
      }
    }
    if (this.clients.size === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private replayHistoryToClient(res: Response, events: SSEEvent[]): void {
    const CHUNK = 48;
    let i = 0;
    const writeChunk = (): void => {
      if (res.writableEnded || res.destroyed) return;
      const end = Math.min(i + CHUNK, events.length);
      for (; i < end; i++) {
        const evt = events[i]!;
        res.write(this.serialize(evt.id, evt.eventName, evt.data));
      }
      if (i < events.length) {
        setImmediate(writeChunk);
      }
    };
    writeChunk();
  }

  private serialize(id: number, eventName: string, data: unknown): string {
    try {
      return `id: ${id}\nevent: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `id: ${id}\nevent: error\ndata: ${JSON.stringify({
        message: `SSE JSON.stringify failed: ${msg.slice(0, 400)}`,
      })}\n\n`;
    }
  }

  private ensureHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.clients.size === 0) return;
      const dead: string[] = [];
      for (const client of this.clients.values()) {
        try {
          client.res.write(`: heartbeat ${Date.now()}\n\n`);
        } catch {
          dead.push(client.id);
        }
      }
      for (const id of dead) {
        this.dropClient(id);
      }
    }, 8_000);
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
