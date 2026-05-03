import type { Response } from "express";

interface SSEClient {
  id: string;
  res: Response;
}

export class SSEManager {
  private clients = new Map<string, SSEClient>();
  private idCounter = 0;

  add(res: Response): string {
    const id = String(++this.idCounter);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    this.clients.set(id, { id, res });

    res.on("close", () => {
      this.clients.delete(id);
    });

    // Send initial connected event
    res.write(`event: connected\ndata: {"id":"${id}"}\n\n`);

    return id;
  }

  send(eventName: string, data: unknown): void {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients.values()) {
      client.res.write(payload);
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
