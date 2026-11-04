import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_WARM_VOICE_ID } from "./speech_models.js";

const assets = fileURLToPath(new URL("../local-voice/", import.meta.url));
const home = () => process.env["LIMINAL_LOCAL_VOICE_HOME"] || path.join(os.homedir(), ".liminal", "voices", LOCAL_WARM_VOICE_ID);
const installHelp = "Install the local voice first: liminal voice install (or node packages/core/local-voice/setup.mjs install in a desktop runtime).";

/** One warm process per daemon. Requests are serialized; cancellation discards the active worker. */
export class LocalSpeechClient {
  private child?: ChildProcessWithoutNullStreams;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 0;
  private buffer = "";
  private stderr = "";
  private pending?: { id: number; resolve: (audio: Uint8Array) => void; reject: (error: Error) => void };
  private idle?: ReturnType<typeof setTimeout>;

  constructor(private readonly command: string, private readonly args: string[]) {}

  private start(): void {
    if (this.child) return;
    const child = spawn(this.command, this.args, { stdio: "pipe", windowsHide: true });
    this.child = child; this.buffer = ""; this.stderr = "";
    // A decoder crash can close stdin between two requests. Handle the stream's error event
    // as well as the write callback so EPIPE cannot crash the parent daemon.
    child.stdin.on("error", error => { if (this.child === child) this.close(error); });
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data: string) => { this.stderr = (this.stderr + data).slice(-1200); });
    child.stdout.on("data", (data: string) => {
      if (this.child !== child) return;
      this.buffer += data;
      if (this.buffer.length > 12 * 1024 * 1024) { this.close(new Error("Local speech response exceeded its size limit.")); return; }
      let end: number;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try {
          const result = JSON.parse(line) as { id?: number; audio?: string; error?: string };
          if (!this.pending || result.id !== this.pending.id) throw new Error("Unexpected local speech response.");
          const pending = this.pending; this.pending = undefined;
          if (result.error) pending.reject(new Error(result.error));
          else {
            const audio = Buffer.from(result.audio ?? "", "base64");
            if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") pending.reject(new Error("Local voice returned invalid WAV audio."));
            else pending.resolve(audio);
          }
        } catch (error) { this.close(error instanceof Error ? error : new Error(String(error))); }
      }
    });
    child.once("error", error => { if (this.child === child) this.close(new Error(`Local speech could not start: ${error.message}. ${installHelp}`)); });
    child.once("exit", () => { if (this.child === child) this.close(new Error(`Local speech stopped unexpectedly. ${this.stderr.slice(-600)}`)); });
    // A warm voice should not keep a CLI invocation alive when there is no active request.
    child.unref();
    for (const stream of [child.stdin, child.stdout, child.stderr]) (stream as unknown as { unref?: () => void }).unref?.();
  }

  synthesize(text: string, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (signal?.aborted) return Promise.reject(new Error("Local speech cancelled."));
    const operation = this.queue.catch(() => {}).then(() => this.request(text, timeoutMs, signal));
    this.queue = operation;
    // Cancel a queued request immediately too; request() checks the signal before starting later.
    if (!signal) return operation;
    let listener: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      listener = () => reject(new Error("Local speech cancelled."));
      signal.addEventListener("abort", listener, { once: true });
    });
    return Promise.race([operation, cancelled]).finally(() => signal.removeEventListener("abort", listener));
  }

  private request(text: string, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (signal?.aborted) return Promise.reject(new Error("Local speech cancelled."));
    if (this.idle) clearTimeout(this.idle);
    this.start();
    const id = ++this.nextId;
    return new Promise<Uint8Array>((resolve, reject) => {
      const abort = () => this.close(new Error("Local speech cancelled."));
      const timer = setTimeout(() => this.close(new Error("Local speech timed out. Try a shorter passage or install the CUDA runtime.")), timeoutMs);
      const done = () => {
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
        this.idle = setTimeout(() => this.close(), 120_000); this.idle.unref();
      };
      this.pending = { id, resolve: audio => { done(); resolve(audio); }, reject: error => { done(); reject(error); } };
      signal?.addEventListener("abort", abort, { once: true });
      this.child!.stdin.write(JSON.stringify({ id, text }) + "\n", error => { if (error) this.close(error); });
    });
  }

  close(error = new Error("Local speech worker closed.")): void {
    const child = this.child; this.child = undefined;
    if (this.idle) { clearTimeout(this.idle); this.idle = undefined; }
    const pending = this.pending; this.pending = undefined;
    pending?.reject(error);
    child?.kill();
  }
}

let client: LocalSpeechClient | undefined;
let clientHome: string | undefined;
export function closeLocalSpeech(): void { client?.close(); client = undefined; }
process.once("exit", closeLocalSpeech);

export async function synthesizeLocalSpeech(text: string, timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array> {
  const root = home();
  const python = path.join(root, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  let installed = false;
  try {
    const manifest = JSON.parse(readFileSync(path.join(assets, "manifest.json"), "utf8")) as { id: string; baseRevision: string };
    const marker = JSON.parse(readFileSync(path.join(root, "ready.json"), "utf8")) as { id?: string; baseRevision?: string };
    installed = marker.id === manifest.id && marker.baseRevision === manifest.baseRevision;
  } catch { /* helpful setup error below */ }
  if (!installed || !existsSync(python)) throw new Error(installHelp);
  if (!client || clientHome !== root) {
    closeLocalSpeech(); clientHome = root;
    client = new LocalSpeechClient(python, ["-X", "utf8", "-B", "-u", path.join(assets, "worker.py"), "--home", root]);
  }
  return client.synthesize(text, Math.max(180_000, timeoutMs), signal);
}
