import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getNotesFacade, runWithOrgContext, LocalNotesFacade } from "./notes_facade.js";

describe("notes_facade", () => {
  it("LocalNotesFacade stamps orgId on write", async () => {
    const facade = new LocalNotesFacade();
    const key = `test:facade_${Date.now()}`;
    await runWithOrgContext({ orgId: "org_test", userId: "user_test" }, async () => {
      await facade.atomicUpdate((n) => ({ ...n, [key]: "hello team" }), "task_test", {
        scope: "workspace",
      });
      const raw = await facade.readAll();
      const note = raw[key];
      assert.ok(note && typeof note === "object");
      assert.equal((note as { orgId?: string }).orgId, "org_test");
      assert.equal((note as { userId?: string }).userId, "user_test");
      await facade.atomicUpdate((n) => {
        const next = { ...n };
        delete next[key];
        return next;
      });
    });
  });

  it("getNotesFacade returns local implementation by default", () => {
    const f = getNotesFacade();
    assert.equal(typeof f.readAll, "function");
    assert.equal(typeof f.atomicUpdate, "function");
  });
});
