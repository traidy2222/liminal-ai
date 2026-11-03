import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

function validBusy(raw) {
  return raw && typeof raw === "object" && raw.status === "busy" &&
    typeof raw.busy_tool === "string" && Number.isFinite(raw.busy_sec) && raw.busy_sec >= 0 &&
    Number.isInteger(raw.queued_calls) && raw.queued_calls >= 0 &&
    Number.isFinite(raw.uptime_sec) && raw.uptime_sec >= 0;
}

async function abortable(promise, signal) {
  signal.throwIfAborted();
  let aborted;
  const cancelled = new Promise((_, reject) => {
    aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener("abort", aborted); }
}

/** Compatibility repair for REA 6.4. Poll health only; never replay analysis. */
export async function waitForIdaHealth({
  callHealth, parseHealth, validateIdentity, protocolError, timeoutError: makeTimeoutError, signal,
  budgetMs = 30_000, now = () => performance.now(),
  sleep = (ms, signal) => delay(ms, undefined, { signal }),
}) {
  signal?.throwIfAborted();
  const budget = Math.min(30_000, Math.max(1, Number.isFinite(budgetMs) ? budgetMs : 30_000));
  const deadline = now() + budget;
  const timeout = new AbortController();
  const timeoutError = () => makeTimeoutError(budget);
  const timer = setTimeout(() => timeout.abort(timeoutError()), budget);
  const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  try {
    for (;;) {
      requestSignal.throwIfAborted();
      const remaining = deadline - now();
      if (remaining <= 0) throw timeoutError();
      const raw = await abortable(Promise.resolve().then(() => {
        requestSignal.throwIfAborted();
        return callHealth({ signal: requestSignal, timeoutMs: Math.ceil(remaining) });
      }), requestSignal);
      requestSignal.throwIfAborted();
      if (now() >= deadline) throw timeoutError();
      if (!validBusy(raw)) {
        // Malformed busy/ok/unknown payloads remain producer errors. A valid
        // response must prove the same admitted identity even while not ready.
        const metadata = parseHealth(raw);
        await validateIdentity(metadata);
        requestSignal.throwIfAborted();
        if (now() >= deadline) throw timeoutError();
        if (metadata.auto_analysis_ready === true) return { raw, metadata };
        if (metadata.auto_analysis_ready !== false)
          throw protocolError("IDA auto-analysis readiness is unknown; the producer did not report a boolean state.");
      }
      const wait = Math.min(100, deadline - now());
      if (wait <= 0) throw timeoutError();
      await sleep(wait, requestSignal);
    }
  } finally { clearTimeout(timer); }
}
