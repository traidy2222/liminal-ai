export type InferenceLatencyEvent = {
  traceId?: string;
  model: string;
  requestStartMs: number;
  responseStartMs?: number;
  firstTokenMs?: number;
  completionMs?: number;
  totalLatencyMs?: number;
  ttftMs?: number;
};

export type InferenceLatencySink = {
  record(event: InferenceLatencyEvent): void | Promise<void>;
};

const sinks: InferenceLatencySink[] = [];

export function registerInferenceLatencySink(sink: InferenceLatencySink): void {
  if (!sinks.includes(sink)) {
    sinks.push(sink);
  }
}

export function clearInferenceLatencySinks(): void {
  sinks.length = 0;
}

export function recordInferenceLatency(event: InferenceLatencyEvent): void {
  for (const sink of sinks) {
    try {
      sink.record(event);
    } catch {
      // Swallow sink errors to avoid disrupting inference
    }
  }
}

export class InferenceLatencyTracker {
  private requestStartMs: number = 0;
  private responseStartMs: number | null = null;
  private firstTokenMs: number | null = null;
  private completionMs: number | null = null;
  private readonly traceId?: string;
  private readonly model: string;

  constructor(model: string, traceId?: string) {
    this.model = model;
    this.traceId = traceId;
  }

  markRequestStart(): void {
    this.requestStartMs = Date.now();
  }

  markResponseStart(): void {
    if (this.responseStartMs === null) {
      this.responseStartMs = Date.now();
    }
  }

  markFirstToken(): void {
    if (this.firstTokenMs === null) {
      this.firstTokenMs = Date.now();
    }
  }

  markCompletion(): InferenceLatencyEvent {
    this.completionMs = Date.now();
    const totalLatencyMs = this.completionMs - this.requestStartMs;
    const ttftMs = this.firstTokenMs !== null 
      ? this.firstTokenMs - this.requestStartMs 
      : this.responseStartMs !== null 
        ? this.responseStartMs - this.requestStartMs 
        : undefined;

    const event: InferenceLatencyEvent = {
      ...(this.traceId ? { traceId: this.traceId } : {}),
      model: this.model,
      requestStartMs: this.requestStartMs,
      ...(this.responseStartMs !== null ? { responseStartMs: this.responseStartMs } : {}),
      ...(this.firstTokenMs !== null ? { firstTokenMs: this.firstTokenMs } : {}),
      completionMs: this.completionMs,
      totalLatencyMs,
      ...(ttftMs !== undefined ? { ttftMs } : {}),
    };

    recordInferenceLatency(event);
    return event;
  }

  getMetrics(): {
    requestStartMs: number;
    responseStartMs: number | null;
    firstTokenMs: number | null;
    completionMs: number | null;
  } {
    return {
      requestStartMs: this.requestStartMs,
      responseStartMs: this.responseStartMs,
      firstTokenMs: this.firstTokenMs,
      completionMs: this.completionMs,
    };
  }
}

export function createConsoleLatencySink(): InferenceLatencySink {
  return {
    record(event: InferenceLatencyEvent): void {
      const ttft = event.ttftMs ? `${event.ttftMs}ms ttft` : "";
      const total = event.totalLatencyMs ? `${event.totalLatencyMs}ms total` : "";
      console.log(
        `[inference_latency] model=${event.model} ${ttft} ${total}`.trim()
      );
    },
  };
}

export function inferenceLatencyEnabled(): boolean {
  return sinks.length > 0;
}
