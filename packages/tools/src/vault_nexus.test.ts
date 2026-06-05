import assert from "node:assert/strict";
import test from "node:test";
import {
  appendLogLine,
  bodyLinksTo,
  buildContradictionCallout,
  buildRelatedSection,
  injectRelatedLinks,
  prependCallout,
  selectCrossLinks,
  upsertIndexEntry,
  type NeighborCandidate,
} from "./vault_nexus.js";

const cands = (xs: Array<[string, number]>): NeighborCandidate[] =>
  xs.map(([title, score]) => ({ title, slug: title.toLowerCase().replace(/\s+/g, "-"), score }));

test("selectCrossLinks ranks, dedupes, drops self and sub-threshold", () => {
  const picked = selectCrossLinks(
    "Iran",
    cands([
      ["Israel", 0.8],
      ["Iran", 0.99], // self — excluded
      ["israel", 0.7], // dup (case-insensitive)
      ["Hezbollah", 0.5],
      ["Noise", 0.05], // below minScore
    ]),
    { max: 6, minScore: 0.15 }
  );
  assert.deepEqual(picked, ["Israel", "Hezbollah"]);
});

test("selectCrossLinks respects max", () => {
  const picked = selectCrossLinks("A", cands([["B", 0.9], ["C", 0.8], ["D", 0.7]]), { max: 2 });
  assert.deepEqual(picked, ["B", "C"]);
});

test("bodyLinksTo detects existing wikilink incl. alias", () => {
  assert.equal(bodyLinksTo("see [[Israel]] now", "Israel"), true);
  assert.equal(bodyLinksTo("see [[Israel|the state]]", "Israel"), true);
  assert.equal(bodyLinksTo("no link here", "Israel"), false);
});

test("injectRelatedLinks appends a Related section, skipping existing links", () => {
  const body = "Body mentions [[Israel]] already.";
  const out = injectRelatedLinks(body, ["Israel", "Hezbollah"]);
  assert.ok(out.includes("## Related"));
  assert.ok(out.includes("- [[Hezbollah]]"));
  // Israel already linked in body → not duplicated as a bullet
  assert.equal((out.match(/- \[\[Israel\]\]/g) ?? []).length, 0);
});

test("injectRelatedLinks merges into existing Related header", () => {
  const body = "Intro\n\n## Related\n- [[Existing]]";
  const out = injectRelatedLinks(body, ["NewOne"]);
  assert.ok(out.includes("- [[Existing]]"));
  assert.ok(out.includes("- [[NewOne]]"));
  assert.equal((out.match(/## Related/g) ?? []).length, 1);
});

test("injectRelatedLinks is a no-op when nothing is new", () => {
  const body = "x [[A]] [[B]]";
  assert.equal(injectRelatedLinks(body, ["A", "B"]), body);
});

test("buildRelatedSection / contradiction / prepend formatting", () => {
  assert.equal(buildRelatedSection([]), "");
  assert.ok(buildRelatedSection(["X"]).startsWith("## Related"));
  const cc = buildContradictionCallout({ conflictingTitle: "Old Note", detail: "claims 10 dead" });
  assert.ok(cc.includes("[!contradiction]"));
  assert.ok(cc.includes("[[Old Note]]"));
  assert.ok(prependCallout("body", cc).startsWith("> [!contradiction]"));
});

test("appendLogLine creates header then appends parseable lines", () => {
  let log = appendLogLine("", { date: "2026-06-05", action: "ingest", title: "Iran" });
  assert.ok(log.includes("# Log"));
  assert.ok(log.includes("## [2026-06-05] ingest | Iran"));
  log = appendLogLine(log, { date: "2026-06-06", action: "update", title: "Israel" });
  assert.ok(log.includes("## [2026-06-06] update | Israel"));
  assert.equal((log.match(/# Log/g) ?? []).length, 1);
});

test("upsertIndexEntry replaces same-title line and sorts", () => {
  let idx = upsertIndexEntry("", { title: "Beta", type: "entity", summary: "second" });
  idx = upsertIndexEntry(idx, { title: "Alpha", type: "fact", summary: "first" });
  // Alpha should sort before Beta
  const aPos = idx.indexOf("[[Alpha]]");
  const bPos = idx.indexOf("[[Beta]]");
  assert.ok(aPos > -1 && bPos > -1 && aPos < bPos);
  // Update Beta — no duplicate line
  idx = upsertIndexEntry(idx, { title: "Beta", type: "entity", summary: "updated" });
  assert.equal((idx.match(/\[\[Beta\]\]/g) ?? []).length, 1);
  assert.ok(idx.includes("updated"));
});
