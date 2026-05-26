import { createWriteStream } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
import {
  createContentStreamParseState,
  getDecodedContentFromRaw,
  ingestToolArgJsonDelta,
  type ContentStreamParseState,
} from "./tool_arg_content_stream.js";

export type FileWriteSinkMode = "create" | "append";

type SinkEntry = {
  callId: string;
  toolName: string;
  parse: ContentStreamParseState;
  stagingPath: string;
  targetPath: string | null;
  mode: FileWriteSinkMode;
  stream: ReturnType<typeof createWriteStream> | null;
  bytesWritten: number;
  closed: boolean;
  sinkActive: boolean;
};

export function resolveWriteStreamSinkEnabled(prefs: RuntimePreferences | null): boolean {
  return resolveHarnessEnvRaw("AGENT_WRITE_STREAM_SINK", prefs) === "1";
}

export function resolveWriteStreamSinkMinChars(prefs: RuntimePreferences | null): number {
  const raw = resolveHarnessEnvRaw("AGENT_WRITE_STREAM_SINK_MIN_CHARS", prefs) ?? "8000";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 8000;
}

function inflightDir(chatId: string | null): string {
  // Per-chat layout: stage under ~/.liminal/chats/<chatId>/write_staging/inflight
  // so a chat bound to an external folder doesn't pollute that folder, and so
  // scratch chats keep their staging alongside their workspace.
  if (chatId) {
    // Lazy require to avoid widening this module's import graph.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gs = require("./global_storage.js") as typeof import("./global_storage.js");
    return gs.ensurePerChatDirSync(chatId, "write_staging", "inflight");
  }
  // Legacy: workspace-local staging when no chatId is known.
  return path.join(resolveWorkspaceRoot(), ".agent_write_staging", "inflight");
}

function stagingPathFor(callId: string, chatId: string | null): string {
  const safe = callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return path.join(inflightDir(chatId), `${safe}.tmp`);
}

function resolveTargetPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(resolveWorkspaceRoot(), p);
}

export class FileWriteStreamSink {
  private readonly entries = new Map<string, SinkEntry>();

  constructor(
    private readonly enabled: boolean,
    private readonly minChars: number,
    /** Chat / harness taskId — used to scope the staging dir per-chat. */
    private readonly chatId: string | null = null
  ) {}

  open(callId: string, toolName: string): void {
    if (!this.enabled) return;
    if (!this.entries.has(callId)) {
      this.entries.set(callId, {
        callId,
        toolName,
        parse: createContentStreamParseState(),
        stagingPath: stagingPathFor(callId, this.chatId),
        targetPath: null,
        // Staging is always a fresh file; the real create/overwrite/append mode
        // is applied by the write_file handler from its parsed `mode` arg.
        mode: "create",
        stream: null,
        bytesWritten: 0,
        closed: false,
        sinkActive: false,
      });
    }
  }

  async ingestDelta(callId: string, toolName: string, delta: string): Promise<void> {
    if (!this.enabled || !delta) return;
    this.open(callId, toolName);
    const entry = this.entries.get(callId);
    if (!entry || entry.closed) return;

    const { path: parsedPath, newContent } = ingestToolArgJsonDelta(entry.parse, delta);
    if (parsedPath && !entry.targetPath) {
      entry.targetPath = resolveTargetPath(parsedPath);
    }

    if (!entry.sinkActive) {
      if (entry.parse.contentEmittedLen < this.minChars) return;
      entry.sinkActive = true;
      const backlog = getDecodedContentFromRaw(entry.parse);
      if (backlog && entry.targetPath) {
        await this.writeChunk(entry, backlog);
      }
      return;
    }

    if (newContent && entry.targetPath) {
      await this.writeChunk(entry, newContent);
    }
  }

  private async writeChunk(entry: SinkEntry, chunk: string): Promise<void> {
    try {
      await this.ensureStream(entry);
      if (!entry.stream || entry.closed) return;
      const ok = entry.stream.write(chunk, "utf8");
      entry.bytesWritten += Buffer.byteLength(chunk, "utf8");
      if (!ok) {
        await new Promise<void>((resolve) => entry.stream!.once("drain", resolve));
      }
    } catch {
      /* best-effort staging */
    }
  }

  private async ensureStream(entry: SinkEntry): Promise<void> {
    if (entry.stream) return;
    await mkdir(inflightDir(this.chatId), { recursive: true });
    entry.stream = createWriteStream(entry.stagingPath, { encoding: "utf8", flags: "w" });
  }

  async finalize(callId: string): Promise<void> {
    const entry = this.entries.get(callId);
    if (!entry || entry.closed) return;
    entry.closed = true;
    if (entry.stream) {
      await new Promise<void>((resolve, reject) => {
        entry.stream!.end(() => resolve());
        entry.stream!.on("error", reject);
      });
    }
  }

  discard(callId: string): void {
    const entry = this.entries.get(callId);
    if (!entry) return;
    entry.closed = true;
    if (entry.stream) {
      entry.stream.destroy();
    }
    void rm(entry.stagingPath, { force: true });
    this.entries.delete(callId);
  }

  takeForDispatch(callId: string): {
    stagingPath: string;
    targetPath: string;
    mode: FileWriteSinkMode;
    bytesWritten: number;
  } | null {
    const entry = this.entries.get(callId);
    if (!entry || !entry.sinkActive || !entry.targetPath || entry.bytesWritten === 0) {
      return null;
    }
    this.entries.delete(callId);
    return {
      stagingPath: entry.stagingPath,
      targetPath: entry.targetPath,
      mode: entry.mode,
      bytesWritten: entry.bytesWritten,
    };
  }

  async getStagingByteCount(callId: string): Promise<number> {
    const entry = this.entries.get(callId);
    if (!entry) return 0;
    try {
      const s = await stat(entry.stagingPath);
      return s.size;
    } catch {
      return entry.bytesWritten;
    }
  }

  buildLengthResumeHint(callId: string): string {
    const entry = this.entries.get(callId);
    if (!entry?.targetPath || entry.bytesWritten === 0) return "";
    return ` Partial bytes (${entry.bytesWritten}) staged at ${entry.stagingPath} for ${entry.targetPath} — continue with write_file mode=append.`;
  }

  /** Copy staged bytes to target so partial progress survives a truncated stream. */
  async salvagePartialToTarget(callId: string): Promise<{ targetPath: string; bytes: number } | null> {
    const entry = this.entries.get(callId);
    if (!entry?.targetPath || entry.bytesWritten === 0) return null;
    await this.finalize(callId);
    try {
      await mkdir(path.dirname(entry.targetPath), { recursive: true });
      if (entry.mode === "append") {
        const staged = await readFile(entry.stagingPath, "utf8");
        await appendFile(entry.targetPath, staged, "utf8");
      } else {
        await copyFile(entry.stagingPath, entry.targetPath);
      }
      const s = await stat(entry.targetPath);
      return { targetPath: entry.targetPath, bytes: s.size };
    } catch {
      return null;
    }
  }
}
