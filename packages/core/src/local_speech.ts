import { runLocalAudio } from "./local_audio_runtime.js";
import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnPythonWorker } from "./python_worker_process.js";
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
  private device?: string;
  private pending?: { id: number; op?: "release" | "warmup"; resolve: (audio: Uint8Array) => void; reject: (error: Error) => void };
  private idle?: ReturnType<typeof setTimeout>;
  private keepWarm = false;
  private closing: Promise<void> = Promise.resolve();
  get hasWorker(): boolean { return this.child !== undefined; }
  get gpuReady(): boolean { return this.child !== undefined && this.device === 'cuda'; }

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly spawnWorker: (command: string, args: string[]) => ChildProcessWithoutNullStreams =
      spawnPythonWorker
  ) {}

  private start(): void {
    if (this.child) return;
    const child = this.spawnWorker(this.command, this.args);
    this.child = child; this.buffer = ""; this.stderr = ""; this.device = undefined;
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
          const result = JSON.parse(line) as { id?: number; audio?: string; error?: string; released?: boolean; residentGpu?: boolean; ready?: boolean; started?: boolean; device?: string };
          if (!this.pending || result.id !== this.pending.id) throw new Error("Unexpected local speech response.");
          if (result.started) { this.device = result.device; continue; }
          const pending = this.pending; this.pending = undefined;
          if (result.error) {
            // Model errors may leave partially moved CUDA state. Retire it before retry.
            void this.closeAndWait().then(() => pending.reject(new Error(result.error)));
          }
          else if (pending.op) {
            if (pending.op === 'release') this.device = result.residentGpu ? 'cuda' : 'cpu';
            const acknowledged = pending.op === "release" ? result.released : result.ready;
            if (acknowledged !== true) pending.reject(new Error("Local voice control was not acknowledged"));
            else pending.resolve(new Uint8Array());
          }
          else {
            const audio = Buffer.from(result.audio ?? "", "base64");
            if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") pending.reject(new Error("Local voice returned invalid WAV audio."));
            else pending.resolve(audio);
          }
        } catch (error) { this.close(error instanceof Error ? error : new Error(String(error))); }
      }
    });
    child.once("error", error => { if (this.child === child) this.close(new Error(`Local speech could not start: ${error.message}. ${installHelp}`)); });
    child.once("exit", (code, signal) => { if (this.child === child) this.close(new Error(`Local speech stopped unexpectedly (exit ${code ?? signal ?? "unknown"}). ${this.stderr.slice(-600)}`)); });
    // A warm voice should not keep a CLI invocation alive when there is no active request.
    child.unref();
    for (const stream of [child.stdin, child.stdout, child.stderr]) (stream as unknown as { unref?: () => void }).unref?.();
  }

  synthesize(text: string, timeoutMs: number, signal?: AbortSignal, keepWorkerOnCancel = false): Promise<Uint8Array> {
    if (signal?.aborted) return Promise.reject(new Error("Local speech cancelled."));
    const operation = this.queue.catch(() => {}).then(async () => {
      await this.closing;
      if (signal?.aborted) throw new Error("Local speech cancelled.");
      // A streamed phrase is short. Discard its result on interruption while it
      // finishes internally, rather than destroying a model that takes 25s to load.
      return this.request(text, timeoutMs, signal, undefined, keepWorkerOnCancel);
    });
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

  private request(text: string, timeoutMs: number, signal?: AbortSignal, op?: "release" | "warmup", keepWorkerOnCancel = false, allowResident = false, nextResidentReady = false): Promise<Uint8Array> {
    if (signal?.aborted) return Promise.reject(new Error("Local speech cancelled."));
    if (this.idle) clearTimeout(this.idle);
    this.start();
    const id = ++this.nextId;
    return new Promise<Uint8Array>((resolve, reject) => {
      const abort = () => {
        // CPU synthesis can be much slower: cancellation must free the decoder
        // for ASR instead of waiting for an arbitrarily long CPU phrase.
        if (!keepWorkerOnCancel || this.device !== "cuda") this.close(new Error("Local speech cancelled."));
      };
      const timer = setTimeout(() => this.close(new Error("Local speech timed out. Try a shorter passage or install the CUDA runtime.")), timeoutMs);
      const done = () => {
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
        if (!this.keepWarm) { this.idle = setTimeout(() => this.close(), 120_000); this.idle.unref(); }
      };
      this.pending = { id, op, resolve: audio => { done(); resolve(audio); }, reject: error => { done(); reject(error); } };
      signal?.addEventListener("abort", abort, { once: true });
      this.child!.stdin.write(JSON.stringify({ id, text, ...(op ? { op } : {}), ...(allowResident ? {allow_resident: true} : {}), ...(nextResidentReady ? {next_resident_ready: true} : {}) }) + "\n", error => { if (error) this.close(error); });
    });
  }

  setKeepWarm(enabled: boolean): void {
    this.keepWarm = enabled;
    if (this.idle) { clearTimeout(this.idle); this.idle = undefined; }
    if (!enabled && this.child && !this.pending) {
      this.idle = setTimeout(() => this.close(), 120_000); this.idle.unref();
    }
  }

  async warmup(): Promise<void> {
    const operation = this.queue.catch(() => {}).then(() => this.request("", 180_000, undefined, "warmup"));
    this.queue = operation;
    await operation;
  }

  async releaseGpu(allowResident = false, nextResidentReady = false): Promise<void> {
    if (!this.child) { await this.closing; return; }
    try {
      const operation = this.queue.catch(() => {}).then(() => this.request("", 10_000, undefined, "release", false, allowResident, nextResidentReady));
      this.queue = operation;
      await operation;
    } catch {
      await this.closeAndWait();
    }
  }

  async closeAndWait(): Promise<void> {
    this.close();
    await this.closing;
  }

  close(error = new Error("Local speech worker closed.")): void {
    const child = this.child; this.child = undefined;
    if (this.idle) { clearTimeout(this.idle); this.idle = undefined; }
    const pending = this.pending; this.pending = undefined;
    pending?.reject(error);
    if (child) {
      child.ref();
      const exited = new Promise<void>(resolve => child.once("close", () => resolve()));
      this.closing = Promise.all([this.closing, exited]).then(() => {});
      child.kill();
    }
  }
}

let client: LocalSpeechClient | undefined;
let clientHome: string | undefined;
let keepLocalVoiceWarm = false;
let warming: Promise<void> | undefined;
export function retainLocalSpeech(keepWarm: boolean): void {
  keepLocalVoiceWarm = keepWarm;
  client?.setKeepWarm(keepWarm);
}
/** CPU-only preload cannot compete with the live decoder for GPU ownership. */
export function warmupLocalSpeech(): Promise<void> {
  // CPU preloading is optional. Leave room for weights, conditionals and transient loads.
  if (!client?.hasWorker && os.freemem() < 2 * 1024 ** 3) return Promise.resolve();
  return warming ??= localSpeechClient().warmup().finally(() => { warming = undefined; });
}
export function closeLocalSpeech(): void { client?.close(); client = undefined; }
process.once("exit", closeLocalSpeech);

export async function synthesizeLocalSpeech(text: string, timeoutMs: number, signal?: AbortSignal, keepWorkerOnCancel = false): Promise<Uint8Array> {
  // CPU preload does not own the GPU. Never hold up wake recognition behind a
  // speech request that is still waiting for those weights to load from disk.
  if (warming) {
    signal?.throwIfAborted();
    let abort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("Local speech cancelled."));
      signal?.addEventListener("abort", abort, {once: true});
    });
    try { await Promise.race([warming.catch(() => {}), cancelled]); }
    finally { signal?.removeEventListener("abort", abort); }
  }
  signal?.throwIfAborted();
  return runLocalAudio("speech", async (nextOwner, allowResident, nextResidentReady) => { await client?.releaseGpu(allowResident === true && nextOwner?.includes('whisper') === true, nextResidentReady); },
    () => localSpeechClient().synthesize(text, Math.max(180_000, timeoutMs), signal, keepWorkerOnCancel), signal,
    {allowResident: true, residentReady: () => client?.gpuReady === true});
}
function localSpeechClient(): LocalSpeechClient {
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
    client.setKeepWarm(keepLocalVoiceWarm);
  }
  return client;
}
