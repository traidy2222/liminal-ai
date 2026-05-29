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
    const replayHistory = req.query["replayHistory"] === "1";

    // Send initial connected event with server-side cursor.
    const connectedCursor = this.eventCounter;
    res.write(`event: connected\ndata: ${JSON.stringify({ id, cursor: connectedCursor })}\n\n`);

    // Replay buffered events: full history (page remount) or tail after Last-Event-ID.
    if (replayHistory && this.history.length > 0) {
      this.replayHistoryToClient(res, this.history);
    } else if (hasLastEventId) {
      // Stale cursor after Express restart — replay entire buffer instead of nothing.
      const staleCursor = (lastEventId as number) > connectedCursor;
      const tail = this.history.filter(
        (evt) => staleCursor || evt.id > (lastEventId as number)
      );
      this.replayHistoryToClient(res, tail);
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
      this.dropClient(clientId);
    }
  }

  /**
   * Remove a client and explicitly close its socket. A bare `clients.delete`
   * leaves a half-open connection alive from the browser's perspective: its
   * `EventSource` stays OPEN, never fires `onerror`, never reconnects, and the
   * "ONLINE" badge stays green while no events are delivered. Ending the response
   * sends a FIN so the browser detects the drop and runs its reconnect logic.
   * Safe to call repeatedly (guarded on `writableEnded`); the `res.on("close")`
   * handler may also fire and re-delete, which is a no-op.
   */
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

  /** Write replayed events in chunks so the client can paint incrementally (not one burst). */
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
          // SSE comment heartbeat keeps intermediaries from closing idle streams.
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
