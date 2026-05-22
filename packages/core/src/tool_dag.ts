/**
 * Intra-round tool dependency DAG.
 *
 * The model calls dispatch_graph({ deps: { C: ["A", "B"] } }) to declare that
 * call-id C must wait for calls A and B to complete before it can execute.
 * The dispatcher reads the active DAG and schedules accordingly:
 *   - Independent calls run in parallel as usual
 *   - Dependent calls receive prior results injected into their args via __resolved_deps
 *
 * The DAG is keyed by call-id (the tool_call id from the stream) and lives for
 * exactly one round. It is created fresh each round and discarded after dispatch.
 */

export interface DagEdge {
  /** The call-id that depends on the listed call-ids. */
  dependentCallId: string;
  /** Call-ids that must complete before dependent can execute. */
  prerequisiteCallIds: string[];
}

export interface DagSpec {
  deps: Record<string, string[]>; // dependentCallId → prerequisiteCallIds
}

export class ToolDag {
  private deps = new Map<string, Set<string>>();

  /** Register dependency edges from a dispatch_graph call. */
  register(spec: DagSpec): void {
    for (const [dependent, prereqs] of Object.entries(spec.deps)) {
      if (!Array.isArray(prereqs)) continue;
      const existing = this.deps.get(dependent) ?? new Set<string>();
      for (const p of prereqs) {
        if (typeof p === "string" && p.trim()) existing.add(p.trim());
      }
      this.deps.set(dependent, existing);
    }
  }

  /** Returns true if callId has declared prerequisites. */
  hasPrereqs(callId: string): boolean {
    return (this.deps.get(callId)?.size ?? 0) > 0;
  }

  /** Returns the prerequisite call-ids for a given callId. */
  getPrereqs(callId: string): string[] {
    return [...(this.deps.get(callId) ?? [])];
  }

  /** Returns true when the DAG is empty (no edges declared). */
  isEmpty(): boolean {
    return this.deps.size === 0;
  }

  /** Clear all edges (call between rounds). */
  clear(): void {
    this.deps.clear();
  }

  /**
   * Topologically sort a set of callIds according to declared edges.
   * Returns batches: each batch is a set of callIds that can execute in parallel.
   * Calls with no edges appear in the first batch.
   *
   * Uses Kahn's algorithm. Cycles are broken by treating cyclic nodes as independent.
   */
  topologicalBatches(callIds: string[]): string[][] {
    if (this.isEmpty()) return [callIds];

    const callSet = new Set(callIds);
    // Build in-degree map limited to known callIds
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>(); // prereq → dependents that need it

    for (const id of callIds) {
      inDegree.set(id, 0);
      adjacency.set(id, []);
    }

    for (const [dep, prereqs] of this.deps) {
      if (!callSet.has(dep)) continue;
      let validPrereqs = 0;
      for (const p of prereqs) {
        if (!callSet.has(p)) continue; // ignore prereqs not in this batch
        validPrereqs++;
        const adjList = adjacency.get(p) ?? [];
        adjList.push(dep);
        adjacency.set(p, adjList);
      }
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + validPrereqs);
    }

    const batches: string[][] = [];
    let ready = callIds.filter((id) => (inDegree.get(id) ?? 0) === 0);

    while (ready.length > 0) {
      batches.push([...ready]);
      const nextReady: string[] = [];
      for (const id of ready) {
        for (const dep of adjacency.get(id) ?? []) {
          const newDeg = (inDegree.get(dep) ?? 0) - 1;
          inDegree.set(dep, newDeg);
          if (newDeg === 0) nextReady.push(dep);
        }
      }
      ready = nextReady;
    }

    // Any remaining (cycles) go into a final independent batch
    const scheduled = new Set(batches.flat());
    const unscheduled = callIds.filter((id) => !scheduled.has(id));
    if (unscheduled.length > 0) batches.push(unscheduled);

    return batches;
  }
}
