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
}

export class SSEManager {
  private clients = new Map<string, SSEClient>();
  private idCounter = 0;
  private eventCounter = 0;
  private readonly history: SSEEvent[] = [];
  private readonly historyLimit = 2000;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  add(req: Request, res: Response): string {
    const id = String(++this.idCounter);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
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

    // Accept Last-Event-ID from header (native EventSource on reconnect) or query param
    // (manual reconnect where we can't set headers).
    const lastEventIdRaw =
      req.header("last-event-id") ?? (req.query["lastEventId"] as string | undefined);
    const lastEventId = lastEventIdRaw ? Number.parseInt(lastEventIdRaw, 10) : NaN;
    const hasLastEventId = Number.isFinite(lastEventId);

    // Send initial connected event with server-side cursor.
    const connectedCursor = this.eventCounter;
    res.write(`event: connected\ndata: ${JSON.stringify({ id, cursor: connectedCursor })}\n\n`);

    // Replay missed events on reconnect if browser provided Last-Event-ID.
    if (hasLastEventId) {
      for (const evt of this.history) {
        if (evt.id <= (lastEventId as number)) continue;
        res.write(this.serialize(evt.id, evt.eventName, evt.data));
      }
    }

    return id;
  }

  send(eventName: string, data: unknown): void {
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
    this.history.push({ id, eventName: wireName, data: wireData });
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
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
      this.clients.delete(clientId);
    }
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
          // SSE comment heartbeat keeps intermediaries from closing idle streams.
          client.res.write(`: heartbeat ${Date.now()}\n\n`);
        } catch {
          dead.push(client.id);
        }
      }
      for (const id of dead) {
        this.clients.delete(id);
      }
    }, 8_000);
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
