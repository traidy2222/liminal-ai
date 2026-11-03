import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { settleIdaInventory } from "./cleanup-settlement.mjs";
import { isReleasedWorkerRow } from "../repair-rea-ida-backend.mjs";

const row = { backend: "worker", session_id: "", owned: false, is_active: true, input_path: "/private/target" };
const schema = z.object({ sessions: z.array(z.object({ backend: z.enum(["worker", "gui"]), session_id: z.string(), owned: z.boolean(), is_active: z.boolean(), input_path: z.string() })) });
function fixture(replies, options = {}) {
  let now = 0, calls = 0;
  const requests = [];
  return {
    calls: () => calls, requests,
    run: () => settleIdaInventory({
      listInventory: async request => { requests.push(request); return replies[Math.min(calls++, replies.length - 1)]; },
      parseInventory: raw => schema.parse(raw),
      isBlocking: entry => entry.session_id === "owned-session" || (!isReleasedWorkerRow(entry) && entry.input_path === row.input_path),
      protocolError: message => new Error(message), budgetMs: 250,
      now: () => now, sleep: async ms => { now += ms; }, ...options,
    }),
  };
}

test("actual active empty-ID teardown row must settle before release; only inventory is polled", async () => {
  const f = fixture([{ sessions: [row] }, { sessions: [row] }, { sessions: [] }]);
  assert.deepEqual(await f.run(), { sessions: [] }); assert.equal(f.calls(), 3);
  assert.deepEqual(f.requests.map(request => request.timeoutMs), [250, 150, 50]);
  for (const request of f.requests) assert(request.signal instanceof AbortSignal);
});
test("strict released tombstone succeeds but persistent active/unowned/GUI rows retain workspace", async () => {
  const released = fixture([{ sessions: [{ ...row, is_active: false }] }]);
  await released.run(); assert.equal(released.calls(), 1);
  for (const remaining of [row, { ...row, backend: "gui", is_active: false }, { ...row, session_id: "peer-session", is_active: false }, { ...row, owned: true, is_active: false }]) {
    const f = fixture([{ sessions: [remaining] }]);
    await assert.rejects(f.run(), /remains registered.*250 ms.*workspace was retained/); assert.equal(f.calls(), 3);
  }
});
test("malformed inventory is a producer failure without retry, never evidence of release", async () => {
  for (const raw of [{}, { sessions: [{}] }, { sessions: [{ ...row, is_active: null }] }]) {
    const f = fixture([raw, { sessions: [] }]);
    await assert.rejects(f.run(), error => error instanceof z.ZodError); assert.equal(f.calls(), 1);
  }
});
test("an unresponsive inventory producer cannot exceed the bounded wall-clock cleanup budget", async () => {
  const f = fixture([], { budgetMs: 20, listInventory: () => new Promise(() => {}) });
  await assert.rejects(f.run(), /within 20 ms/);
});
