import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

/** After a verified close acknowledgement, observe release; never replay close. */
export async function settleIdaInventory({
  listInventory, parseInventory, isBlocking, protocolError, budgetMs = 10_000,
  now = () => performance.now(), sleep = (ms, signal) => delay(ms, undefined, { signal }),
}) {
  const budget = Math.min(10_000, Math.max(1, Number.isFinite(budgetMs) ? budgetMs : 10_000));
  const deadline = now() + budget;
  const controller = new AbortController();
  const failure = () => protocolError(`IDA worker remains registered after close; inventory did not settle within ${budget} ms. The private workspace was retained.`);
  const timer = setTimeout(() => controller.abort(failure()), budget);
  try {
    for (;;) {
      controller.signal.throwIfAborted();
      const remaining = deadline - now();
      if (remaining <= 0) throw failure();
      let onAbort;
      const abort = new Promise((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      let raw;
      try {
        raw = await Promise.race([Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return listInventory({ signal: controller.signal, timeoutMs: Math.ceil(remaining) });
        }), abort]);
      } finally { controller.signal.removeEventListener("abort", onAbort); }
      controller.signal.throwIfAborted();
      if (now() >= deadline) throw failure();
      const inventory = parseInventory(raw); // Malformed producer data fails now.
      if (!inventory.sessions.some(isBlocking)) return inventory;
      const wait = Math.min(100, deadline - now());
      if (wait <= 0) throw failure();
      await sleep(wait, controller.signal);
    }
  } finally { clearTimeout(timer); }
}
