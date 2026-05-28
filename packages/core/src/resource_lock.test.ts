import assert from "node:assert/strict";
import test from "node:test";
import { ResourceLockManager } from "./orchestrator.js";

test("ResourceLockManager allows reentrant acquire from same task", async () => {
  const locks = new ResourceLockManager();
  const id = "shell:/tmp";
  const task = "chat_abc";

  assert.equal(await locks.acquireAll([id], task), true);
  assert.equal(await locks.acquireAll([id], task), true);

  locks.releaseAll([id], task);
  assert.deepEqual(locks.getHolders(id), [task]);

  locks.releaseAll([id], task);
  assert.deepEqual(locks.getHolders(id), []);
});

test("ResourceLockManager blocks a different task until release", async () => {
  const locks = new ResourceLockManager();
  const id = "shell:/tmp";

  assert.equal(await locks.acquireAll([id], "task_a"), true);
  assert.equal(await locks.acquireAll([id], "task_b"), false);

  locks.releaseAll([id], "task_a");
  assert.equal(await locks.acquireAll([id], "task_b"), true);
  locks.releaseAll([id], "task_b");
});
