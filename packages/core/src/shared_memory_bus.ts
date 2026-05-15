/**
 * Cross-harness shared memory bus — allows sibling sub-agents and parent/child
 * harnesses to publish named facts and subscribe to updates within one session.
 *
 * Scoped per spawn_agent/wait_for_agents session — NOT persisted to disk.
 * Pass a SharedMemoryBus instance through AgentConfig.sharedBus.
 */

export interface SharedBusEnvelope {
  type: "fact" | "summary" | "evidence" | "handoff" | "status";
  summary: string;
  evidenceRefs?: string[];
  payload?: string;
  at: number;
}

export type BusListener = (key: string, value: string, publisherId: string) => void;

export class SharedMemoryBus {
  private readonly store = new Map<string, string>();
  private readonly listeners: BusListener[] = [];

  /** Publish a key/value pair; notifies all subscribers immediately. */
  publish(key: string, value: string, publisherId: string): void {
    this.store.set(key, value);
    for (const fn of this.listeners) {
      try {
        fn(key, value, publisherId);
      } catch {
        /* subscriber errors are non-fatal */
      }
    }
  }

  /** Publish a structured envelope to a namespaced key. */
  publishEnvelope(key: string, envelope: SharedBusEnvelope, publisherId: string): void {
    this.publish(key, JSON.stringify(envelope), publisherId);
  }

  /** Read and parse a structured envelope if present and valid. */
  readEnvelope(key: string): SharedBusEnvelope | undefined {
    const raw = this.read(key);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as SharedBusEnvelope;
      if (!parsed || typeof parsed !== "object") return undefined;
      if (!parsed.type || typeof parsed.summary !== "string") return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  /** Read a key from the bus, or undefined if not yet published. */
  read(key: string): string | undefined {
    return this.store.get(key);
  }

  /** List all published key/value pairs (snapshot). */
  getAll(): Record<string, string> {
    return Object.fromEntries(this.store);
  }

  /** Subscribe to future publish calls. Returns an unsubscribe function. */
  subscribe(fn: BusListener): () => void {
    this.listeners.push(fn);
    return () => {
      const idx = this.listeners.indexOf(fn);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** True if the bus has any published entries. */
  hasData(): boolean {
    return this.store.size > 0;
  }

  /** Number of published entries. */
  size(): number {
    return this.store.size;
  }
}
