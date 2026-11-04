/** Serialize local speech/ASR and release the previous GPU model before changing tasks. */
let queue: Promise<unknown> = Promise.resolve();
let active: { owner: string; release: () => Promise<void> } | undefined;

export function runLocalAudio<T>(owner: string, release: () => Promise<void>, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const work = queue.catch(() => {}).then(async () => {
    signal?.throwIfAborted();
    if (active?.owner !== owner) {
      await active?.release();
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
