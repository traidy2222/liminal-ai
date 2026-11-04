import { runLocalAudio } from "./local_audio_runtime.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transcriptionProfile } from "./transcription_models.js";

const assets = fileURLToPath(new URL("../local-asr/", import.meta.url));
const home = () => process.env["LIMINAL_LOCAL_ASR_HOME"] || path.join(os.homedir(), ".liminal", "transcription");
const installHelp = "Install local transcription first: liminal transcription install whisper --cuda (omit --cuda without an NVIDIA GPU), or install qwen for accuracy mode. Portable runtime: node packages/core/local-asr/setup.mjs install whisper --cuda.";

/** One warm process per daemon. Requests are serialized; cancellation discards the active worker. */
export class LocalTranscriptionClient {
  private child?: ChildProcessWithoutNullStreams;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 0;
  private buffer = "";
  private stderr = "";
  private pending?: { id: number; resolve: (audio: LocalTranscript) => void; reject: (error: Error) => void };
  private idle?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly spawnWorker: (command: string, args: string[]) => ChildProcessWithoutNullStreams =
      (command, args) => spawn(command, args, { stdio: "pipe", windowsHide: true })
  ) {}

  private start(): void {
    if (this.child) return;
    const child = this.spawnWorker(this.command, this.args);
    this.child = child; this.buffer = ""; this.stderr = "";
    // A decoder crash can close stdin between two requests. Handle the stream's error event
    // as well as the write callback so EPIPE cannot crash the parent daemon.
    child.stdin.on("error", error => { if (this.child === child) this.close(error); });
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data: string) => { this.stderr = (this.stderr + data).slice(-1200); });
    child.stdout.on("data", (data: string) => {
      if (this.child !== child) return;
      this.buffer += data;
      if (this.buffer.length > 12 * 1024 * 1024) { this.close(new Error("Local transcription response exceeded its size limit.")); return; }
      let end: number;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try {
          const result = JSON.parse(line) as { id?: number; result?: LocalTranscript; error?: string };
          if (!this.pending || result.id !== this.pending.id) throw new Error("Unexpected local transcription response.");
          const pending = this.pending; this.pending = undefined;
          if (result.error) pending.reject(new Error(result.error));
          else {
            if (typeof result.result?.text !== "string" || typeof result.result?.noSpeech !== "boolean") pending.reject(new Error("Local transcription returned an invalid result."));
            else pending.resolve(result.result);
          }
        } catch (error) { this.close(error instanceof Error ? error : new Error(String(error))); }
      }
    });
    child.once("error", error => { if (this.child === child) this.close(new Error(`Local transcription could not start: ${error.message}. ${installHelp}`)); });
    child.once("exit", () => { if (this.child === child) this.close(new Error(`Local transcription stopped unexpectedly. ${this.stderr.slice(-600)}`)); });
    // A warm voice should not keep a CLI invocation alive when there is no active request.
    child.unref();
    for (const stream of [child.stdin, child.stdout, child.stderr]) (stream as unknown as { unref?: () => void }).unref?.();
  }

  transcribe(payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<LocalTranscript> {
    if (signal?.aborted) return Promise.reject(new Error("Local transcription cancelled."));
    const operation = this.queue.catch(() => {}).then(() => this.request(payload, timeoutMs, signal));
    this.queue = operation;
    // Cancel a queued request immediately too; request() checks the signal before starting later.
    if (!signal) return operation;
    let listener: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      listener = () => reject(new Error("Local transcription cancelled."));
      signal.addEventListener("abort", listener, { once: true });
    });
    return Promise.race([operation, cancelled]).finally(() => signal.removeEventListener("abort", listener));
  }

  private request(payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<LocalTranscript> {
    if (signal?.aborted) return Promise.reject(new Error("Local transcription cancelled."));
    if (this.idle) clearTimeout(this.idle);
    this.start();
    const id = ++this.nextId;
    return new Promise<LocalTranscript>((resolve, reject) => {
      const abort = () => this.close(new Error("Local transcription cancelled."));
      const timer = setTimeout(() => this.close(new Error("Local transcription timed out. Try a shorter recording or install the CUDA runtime.")), timeoutMs);
      const done = () => {
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
        this.idle = setTimeout(() => this.close(), 120_000); this.idle.unref();
      };
      this.pending = { id, resolve: audio => { done(); resolve(audio); }, reject: error => { done(); reject(error); } };
      signal?.addEventListener("abort", abort, { once: true });
      this.child!.stdin.write(JSON.stringify({ id, ...payload }) + "\n", error => { if (error) this.close(error); });
    });
  }

  async closeAndWait(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>(resolve => child.once("close", () => resolve()));
    this.close();
    await exited;
  }

  close(error = new Error("Local transcription worker closed.")): void {
    const child = this.child; this.child = undefined;
    if (this.idle) { clearTimeout(this.idle); this.idle = undefined; }
    const pending = this.pending; this.pending = undefined;
    pending?.reject(error);
    child?.kill();
  }
}

export interface LocalTranscript {
  text: string;
  language?: string;
  languageConfidence?: number;
  durationSec: number;
  noSpeech: boolean;
  segments?: Array<{ start: number; end: number; text: string }>;
  words?: Array<{ start: number; end: number; word: string; probability: number }>;
}
let client: LocalTranscriptionClient | undefined;
let activeHome: string | undefined;
export function closeLocalTranscription(): void { client?.close(); client = undefined; }
process.once("exit", closeLocalTranscription);

/** Switching modes releases the old model before loading another; never keep both on the GPU. */
export function transcribeLocalAudio(model: string, payload: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<LocalTranscript> {
  return runLocalAudio(`asr:${model}`, async () => { await client?.closeAndWait(); }, async () => {
    signal?.throwIfAborted();
    const profile = transcriptionProfile(model);
    const root = path.join(home(), profile);
    const python = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    let installed = false;
    try {
      const manifest = JSON.parse(readFileSync(path.join(assets, "manifest.json"), "utf8"));
      const marker = JSON.parse(readFileSync(path.join(root, "ready.json"), "utf8"));
      installed = marker.runtimeVersion === manifest.runtimeVersion && marker.revision === manifest.profiles[profile].baseRevision;
    } catch { /* actionable install error below */ }
    if (!installed || !existsSync(python) || existsSync(path.join(root, "install.lock"))) throw new Error(`${installHelp} Selected mode: ${profile}.`);
    if (!client || activeHome !== root) {
      closeLocalTranscription(); activeHome = root;
      client = new LocalTranscriptionClient(python, ["-X", "utf8", "-B", "-u", path.join(assets, "worker.py"), "--home", root, "--profile", profile]);
    }
    return client.transcribe(payload, Math.max(1000, timeoutMs), signal);
  }, signal);
}
