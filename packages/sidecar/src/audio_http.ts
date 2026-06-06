import type { IncomingMessage, ServerResponse } from "node:http";
import {
  handleAudioUpload,
  handleTranscribe,
  handleTtsPost,
  readTtsClipBytes,
  type AudioBridgeContext,
} from "@liminal/tools/audio-http-handlers";
import type { SessionBridge } from "./session_bridge.js";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function bridgeContext(bridge: SessionBridge): AudioBridgeContext {
  return {
    chatId: bridge.chatId,
    getRuntimePreferences: () => bridge.harness.getRuntimePreferences(),
  };
}

/**
 * Token-gated audio routes mirroring the web server (`/api/audio/*`, `/api/tts/*`).
 */
export function tryHandleAudioRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    token: string;
    resolveBridge: (chatId: string | null) => SessionBridge | undefined;
  }
): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;

  const isAudioUpload = pathname === "/api/audio/upload" && req.method === "POST";
  const isTranscribe = pathname === "/api/transcribe" && req.method === "POST";
  const isTtsPost = pathname === "/api/tts" && req.method === "POST";
  const clipMatch = pathname.match(/^\/api\/tts\/clip\/([^/]+)$/);
  const isTtsClip = !!clipMatch && (req.method === "GET" || req.method === "HEAD");

  if (!isAudioUpload && !isTranscribe && !isTtsPost && !isTtsClip) {
    return false;
  }

  const presented = url.searchParams.get("token") ?? "";
  if (presented !== opts.token) {
    res.writeHead(401);
    res.end("Unauthorized");
    return true;
  }

  const chatId = url.searchParams.get("chatId");
  const bridge = opts.resolveBridge(chatId);
  if (!bridge) {
    sendJson(res, 404, { error: "Chat not found" });
    return true;
  }

  const ctx = bridgeContext(bridge);

  if (isTtsClip) {
    const clipId = decodeURIComponent(clipMatch![1] ?? "");
    void (async () => {
      try {
        const clip = await readTtsClipBytes(ctx, clipId);
        if (!clip) {
          sendJson(res, 404, { error: "clip not found" });
          return;
        }
        res.writeHead(200, {
          "Content-Type": clip.mimeType,
          "Cache-Control": "private, max-age=86400",
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(clip.bytes);
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
    })();
    return true;
  }

  void (async () => {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      let result;
      if (isAudioUpload) {
        result = await handleAudioUpload(ctx, body as Parameters<typeof handleAudioUpload>[1]);
      } else if (isTranscribe) {
        result = await handleTranscribe(ctx, body as Parameters<typeof handleTranscribe>[1]);
      } else {
        result = await handleTtsPost(ctx, body as Parameters<typeof handleTtsPost>[1]);
      }
      sendJson(res, result.status, result.body);
    } catch (err) {
      sendJson(res, 500, { error: (err as Error).message });
    }
  })();

  return true;
}
