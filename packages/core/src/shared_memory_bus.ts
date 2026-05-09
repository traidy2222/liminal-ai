/**
 * Cross-harness shared memory bus — allows sibling sub-agents and parent/child
 * harnesses to publish named facts and subscribe to updates within one session.
 *
 * Scoped per spawn_agent/wait_for_agents session — NOT persisted to disk.
 * Pass a SharedMemoryBus instance through AgentConfig.sharedBus.
 */

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
