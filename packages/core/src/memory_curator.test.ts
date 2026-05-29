import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCuratorPrompt,
  parseCuratorPlan,
  applyCuratorSafetyRails,
  selectReviewSlice,
  protectionRuleFor,
  type CuratorNote,
  type CuratorPlan,
  type CuratorSafetyOpts,
} from "./memory_curator.js";

const NOW = Date.parse("2026-05-30T00:00:00Z");
const OPTS: CuratorSafetyOpts = { protectAccessCount: 3, protectMinAgeHours: 24, nowMs: NOW };

function note(key: string, over: Partial<CuratorNote> = {}): CuratorNote {
  return {
    key,
    value: `value for ${key}`,
    createdAt: "2026-01-01T00:00:00Z", // old enough by default
    accessCount: 0,
    confidence: 0.5,
    scope: "workspace",
    ...over,
  };
}

test("parseCuratorPlan rejects junk and coerces shape", () => {
  assert.equal(parseCuratorPlan(null), null);
  assert.equal(parseCuratorPlan("nope"), null);
  const p = parseCuratorPlan({
    summary: "did things",
    prune: [{ key: "a", reason: "stale" }, { reason: "no key" }, { key: "" }],
    merge: [{ keep: "x", drop: ["y", "x", ""], mergedValue: "m", reason: "dup" }, { keep: "z", drop: [] }],
    adjust: [{ key: "c", confidence: 2 }, { key: "d", confidence: "bad" }],
  });
  assert.ok(p);
  assert.deepEqual(p!.prune.map((x) => x.key), ["a"]); // junk prune entries dropped
  assert.equal(p!.merge.length, 1); // empty-drop merge removed
  assert.deepEqual(p!.merge[0]!.drop, ["y", "x"]); // empty stripped; self-key handled by safety rails
  assert.equal(p!.adjust.length, 1); // non-number confidence dropped
  assert.equal(p!.adjust[0]!.confidence, 1); // clamped into [0,1]
});

test("protectionRuleFor vetoes durable / protected notes", () => {
  assert.equal(protectionRuleFor(note("fact:plain"), OPTS), null);
  assert.equal(protectionRuleFor(note("g", { scope: "global" }), OPTS), "scope=global");
  assert.match(protectionRuleFor(note("identity:name"), OPTS)!, /protected-prefix/);
  assert.match(protectionRuleFor(note("user:tz"), OPTS)!, /protected-prefix/);
  assert.match(protectionRuleFor(note("pref:theme"), OPTS)!, /protected-prefix/);
  assert.match(protectionRuleFor(note("fact:hot", { accessCount: 5 }), OPTS)!, /accessCount/);
  assert.match(
    protectionRuleFor(note("fact:fresh", { createdAt: "2026-05-29T23:00:00Z" }), OPTS)!,
    /age</
  );
});

test("applyCuratorSafetyRails filters prune and strips merge-drops", () => {
  const byKey = new Map<string, CuratorNote>([
    ["fact:stale", note("fact:stale")],
    ["identity:name", note("identity:name")],
    ["fact:hot", note("fact:hot", { accessCount: 9 })],
    ["fact:keep", note("fact:keep")],
    ["fact:dup", note("fact:dup")],
  ]);
  const plan: CuratorPlan = {
    summary: "",
    prune: [
      { key: "fact:stale", reason: "old" },
      { key: "identity:name", reason: "model wrongly tried" },
      { key: "fact:hot", reason: "model wrongly tried" },
    ],
    merge: [{ keep: "fact:keep", drop: ["fact:dup", "identity:name"], mergedValue: "merged", reason: "dup" }],
    adjust: [],
  };
  const { plan: vetted, vetoed } = applyCuratorSafetyRails(plan, byKey, OPTS);

  assert.deepEqual(vetted.prune.map((p) => p.key), ["fact:stale"]); // only the safe one survives
  assert.deepEqual(vetted.merge[0]!.drop, ["fact:dup"]); // protected identity stripped from drop
  const vetoKeys = vetoed.map((v) => v.key).sort();
  assert.deepEqual(vetoKeys, ["fact:hot", "identity:name", "identity:name"]);
});

test("merge with no surviving drops is removed entirely", () => {
  const byKey = new Map<string, CuratorNote>([
    ["fact:keep", note("fact:keep")],
    ["user:x", note("user:x")],
  ]);
  const plan: CuratorPlan = {
    summary: "",
    prune: [],
    merge: [{ keep: "fact:keep", drop: ["user:x"], mergedValue: "m", reason: "r" }],
    adjust: [],
  };
  const { plan: vetted } = applyCuratorSafetyRails(plan, byKey, OPTS);
  assert.equal(vetted.merge.length, 0);
});

test("selectReviewSlice keeps everything under cap, else picks lowest-decay first", () => {
  const all = [
    note("a", { lastAccessedAt: "2026-05-29T00:00:00Z", accessCount: 10 }), // fresh + used → high decay (kept)
    note("b", { lastAccessedAt: "2025-06-01T00:00:00Z", accessCount: 0 }), // very stale → low decay (reviewed)
    note("c", { lastAccessedAt: "2026-05-20T00:00:00Z", accessCount: 1 }),
  ];
  assert.equal(selectReviewSlice(all, 5, NOW).length, 3); // under cap → all

  const slice = selectReviewSlice(all, 2, NOW);
  assert.equal(slice.length, 2);
  assert.ok(slice.some((n) => n.key === "b"), "stalest note must be in the review slice");
  assert.ok(!slice.some((n) => n.key === "a"), "freshest, most-used note kept out of prune review");
});

test("buildCuratorPrompt emits keys, metadata, and a JSON contract", () => {
  const prompt = buildCuratorPrompt([note("fact:foo", { accessCount: 2 })], NOW);
  assert.match(prompt, /\[fact:foo\]/);
  assert.match(prompt, /access=2/);
  assert.match(prompt, /"prune"/);
  assert.match(prompt, /JSON ONLY/);
});
