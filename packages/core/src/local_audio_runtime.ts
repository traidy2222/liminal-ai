/** Serialize local speech/ASR; warm GPU weights may coexist only with verified headroom. */
let queue: Promise<unknown> = Promise.resolve();
let active: { owner: string; release: (nextOwner?: string, allowResident?: boolean, nextResidentReady?: boolean) => Promise<void> } | undefined;

export function runLocalAudio<T>(owner: string, release: (nextOwner?: string, allowResident?: boolean, nextResidentReady?: boolean) => Promise<void>, operation: () => Promise<T>, signal?: AbortSignal, options?: {allowResident?: boolean; residentReady?: boolean | (() => boolean)}): Promise<T> {
  const work = queue.catch(() => {}).then(async () => {
    signal?.throwIfAborted();
    if (active?.owner !== owner) {
      const residentReady = typeof options?.residentReady === 'function' ? options.residentReady() : options?.residentReady === true;
      await active?.release(owner, options?.allowResident === true, residentReady);
      active = { owner, release };
    }
    return operation();
  });
  queue = work;
  if (!signal) return work;
  // Cancellation must be immediate even when queued behind another local task.
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("Local audio cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  return Promise.race([work, cancelled]).finally(() => signal.removeEventListener("abort", abort));
}
