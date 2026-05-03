// ─── Resource Locking ─────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export type LockMode = "read" | "write";

interface LockEntry {
  taskId: string;
  mode: LockMode;
  acquiredAt: number;
  ttl: number;
}

export class ResourceLockManager {
  private readonly locks = new Map<string, LockEntry[]>();

  /**
   * Acquire all locks in alphabetical order (prevents deadlock via lock ordering).
   * Returns true if all acquired, false if any timed out.
   */
  async acquireAll(
    resourceIds: string[],
    taskId: string,
    ttl = 30_000
  ): Promise<boolean> {
    const sorted = [...new Set(resourceIds)].sort();
    const acquired: string[] = [];

    for (const id of sorted) {
      const ok = await this.tryAcquire(id, taskId, ttl);
      if (!ok) {
        this.releaseAll(acquired, taskId);
        return false;
      }
      acquired.push(id);
    }
    return true;
  }

  private async tryAcquire(
    resourceId: string,
    taskId: string,
    ttl: number
  ): Promise<boolean> {
    const deadline = Date.now() + 10_000; // wait up to 10s for lock
    while (Date.now() < deadline) {
      this.evictExpired(resourceId);
      const holders = this.locks.get(resourceId) ?? [];
      if (holders.length === 0) {
        this.locks.set(resourceId, [
          { taskId, mode: "write", acquiredAt: Date.now(), ttl },
        ]);
        return true;
      }
      await sleep(50);
    }
    return false;
  }

  releaseAll(resourceIds: string[], taskId: string): void {
    for (const id of resourceIds) {
      const holders = this.locks.get(id);
      if (!holders) continue;
      const remaining = holders.filter((e) => e.taskId !== taskId);
      if (remaining.length === 0) {
        this.locks.delete(id);
      } else {
        this.locks.set(id, remaining);
      }
    }
  }

  /** Release ALL locks held by a task (called on task completion/cancellation). */
  releaseByTask(taskId: string): void {
    for (const [id, holders] of this.locks) {
      const remaining = holders.filter((e) => e.taskId !== taskId);
      if (remaining.length === 0) {
        this.locks.delete(id);
      } else {
        this.locks.set(id, remaining);
      }
    }
  }

  getHolders(resourceId: string): string[] {
    this.evictExpired(resourceId);
    return (this.locks.get(resourceId) ?? []).map((e) => e.taskId);
  }

  private evictExpired(resourceId: string): void {
    const holders = this.locks.get(resourceId);
    if (!holders) return;
    const now = Date.now();
    const alive = holders.filter((e) => now - e.acquiredAt < e.ttl);
    if (alive.length === 0) {
      this.locks.delete(resourceId);
    } else if (alive.length !== holders.length) {
      this.locks.set(resourceId, alive);
    }
  }
}

// ─── Task Registry ─────────────────────────────────────────────────────────────

export interface TaskRecord {
  taskId: string;
  parentTaskId?: string;
  goal: string;
  depth: number;
  startedAt: number;
  status: "running" | "done" | "error" | "cancelled";
  result?: string;
  abortController: AbortController;
}

export class TaskOrchestrator {
  readonly locks = new ResourceLockManager();
  private readonly tasks = new Map<string, TaskRecord>();

  register(record: TaskRecord): void {
    this.tasks.set(record.taskId, record);
  }

  get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  getAll(): TaskRecord[] {
    return [...this.tasks.values()];
  }

  complete(taskId: string, result: string): void {
    const record = this.tasks.get(taskId);
    if (record) {
      record.status = "done";
      record.result = result;
      this.locks.releaseByTask(taskId);
    }
  }

  fail(taskId: string, error: string): void {
    const record = this.tasks.get(taskId);
    if (record) {
      record.status = "error";
      record.result = error;
      this.locks.releaseByTask(taskId);
    }
  }

  cancel(taskId: string): void {
    const record = this.tasks.get(taskId);
    if (record) {
      record.abortController.abort();
      record.status = "cancelled";
      this.locks.releaseByTask(taskId);
    }
  }

  /** Count of currently running tasks globally. */
  runningCount(): number {
    return [...this.tasks.values()].filter((t) => t.status === "running").length;
  }

  /** Count of running tasks that are direct children of a given parent. */
  activeChildCount(parentTaskId: string): number {
    return [...this.tasks.values()].filter(
      (t) => t.parentTaskId === parentTaskId && t.status === "running"
    ).length;
  }
}
