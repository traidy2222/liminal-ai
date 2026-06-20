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
  buildMocBody,
  mocTitleForTopic,
  injectSourcesLinks,
  selectInboundWeaveTitles,
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
      ["Iran", 0.99],
      ["israel", 0.7],
      ["Hezbollah", 0.5],
      ["Noise", 0.05],
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
  assert.ok(
    buildRelatedSection([{ target: "Entities/x", label: "X" }]).startsWith("## Related")
  );
  const cc = buildContradictionCallout({
    conflictingLink: { target: "Entities/old", label: "Old Note" },
    detail: "claims 10 dead",
  });
  assert.ok(cc.includes("[!contradiction]"));
  assert.ok(cc.includes("Entities/old"));
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
  let idx = upsertIndexEntry("", {
    title: "Beta",
    type: "entity",
    summary: "second",
    linkTarget: "Entities/beta",
  });
  idx = upsertIndexEntry(idx, {
    title: "Alpha",
    type: "fact",
    summary: "first",
    linkTarget: "Facts/alpha",
  });
  const aPos = idx.indexOf("Entities/beta");
  const bPos = idx.indexOf("Facts/alpha");
  assert.ok(aPos > -1 && bPos > -1);
  idx = upsertIndexEntry(idx, {
    title: "Beta",
    type: "entity",
    summary: "updated",
    linkTarget: "Entities/beta",
  });
  assert.equal((idx.match(/\[\[Entities\/beta/g) ?? []).length, 1);
  assert.ok(idx.includes("updated"));
});

test("selectInboundWeaveTitles caps inbound backlinks", () => {
  assert.deepEqual(selectInboundWeaveTitles(["A", "B", "C", "D"], 3), ["A", "B", "C"]);
  assert.deepEqual(selectInboundWeaveTitles(["A"], 3), ["A"]);
});

test("injectSourcesLinks appends Sources section", () => {
  const out = injectSourcesLinks("Body text.", [{ target: "_liminal/raw/2026-06-18-sample", label: "sample" }]);
  assert.ok(out.includes("## Sources"));
  assert.ok(out.includes("[[_liminal/raw/2026-06-18-sample"));
});

test("mocTitleForTopic and buildMocBody", () => {
  assert.equal(mocTitleForTopic("Iran conflict"), "MOC — Iran conflict");
  assert.equal(mocTitleForTopic("MOC — existing"), "MOC — existing");
  const body = buildMocBody("Topic", [{ target: "Entities/a", label: "A" }, { target: "Entities/b", label: "B" }]);
  assert.ok(body.includes("[[Entities/a]]"));
  assert.ok(body.includes("[[Entities/b]]"));
});
