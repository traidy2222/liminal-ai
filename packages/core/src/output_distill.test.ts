import test from "node:test";
import assert from "node:assert/strict";
import { readArtifactText, shouldDistillToolOutput } from "./output_distill.js";

test("readArtifactText returns helpful error when artifact file is missing", async () => {
  const r = await readArtifactText("deadbeef");
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /Artifact not found/i);
  assert.match(r.error, /AGENT_DISTILL|AGENT_TOOL_BODY_ELIDE/i);
});

test("shouldDistillToolOutput leaves read_file alone by default", () => {
  const prev = process.env.AGENT_DISTILL;
  const prevRf = process.env.AGENT_DISTILL_READ_FILE;
  process.env.AGENT_DISTILL = "1";
  delete process.env.AGENT_DISTILL_READ_FILE;
  try {
    // Medium-sized source file — historically distilled at >2k chars, causing
    // the model to lose the code and re-read constantly.
    const mediumFile = "x".repeat(5000);
    assert.equal(shouldDistillToolOutput("read_file", mediumFile), false);
    // Large file under the opt-in cap of 25k chars — still not distilled.
    const largeFile = "x".repeat(20_000);
    assert.equal(shouldDistillToolOutput("read_file", largeFile), false);
  } finally {
    if (prev === undefined) delete process.env.AGENT_DISTILL;
    else process.env.AGENT_DISTILL = prev;
    if (prevRf === undefined) delete process.env.AGENT_DISTILL_READ_FILE;
    else process.env.AGENT_DISTILL_READ_FILE = prevRf;
  }
});

test("shouldDistillToolOutput distills read_file only when explicitly enabled AND output is huge", () => {
  const prev = process.env.AGENT_DISTILL;
  const prevRf = process.env.AGENT_DISTILL_READ_FILE;
  process.env.AGENT_DISTILL = "1";
  process.env.AGENT_DISTILL_READ_FILE = "1";
  try {
    // Still under 25k cap.
    assert.equal(shouldDistillToolOutput("read_file", "x".repeat(20_000)), false);
    // Genuinely huge — distill.
    assert.equal(shouldDistillToolOutput("read_file", "x".repeat(30_000)), true);
  } finally {
    if (prev === undefined) delete process.env.AGENT_DISTILL;
    else process.env.AGENT_DISTILL = prev;
    if (prevRf === undefined) delete process.env.AGENT_DISTILL_READ_FILE;
    else process.env.AGENT_DISTILL_READ_FILE = prevRf;
  }
});

test("shouldDistillToolOutput still distills unbounded sources at low thresholds", () => {
  const prev = process.env.AGENT_DISTILL;
  const prevWf = process.env.AGENT_DISTILL_WEB_FETCH;
  process.env.AGENT_DISTILL = "1";
  process.env.AGENT_DISTILL_WEB_FETCH = "1"; // off by default; explicitly enable for this test
  try {
    // web_fetch (page bodies) — distilled aggressively when opted in
    assert.equal(shouldDistillToolOutput("web_fetch", "x".repeat(2000)), true);
    // recall_relevant (search hits) — distilled by default
    assert.equal(shouldDistillToolOutput("recall_relevant", "x".repeat(3000)), true);
  } finally {
    if (prev === undefined) delete process.env.AGENT_DISTILL;
    else process.env.AGENT_DISTILL = prev;
    if (prevWf === undefined) delete process.env.AGENT_DISTILL_WEB_FETCH;
    else process.env.AGENT_DISTILL_WEB_FETCH = prevWf;
  }
});

test("shouldDistillToolOutput is a no-op when AGENT_DISTILL=0", () => {
  const prev = process.env.AGENT_DISTILL;
  process.env.AGENT_DISTILL = "0";
  try {
    assert.equal(shouldDistillToolOutput("web_fetch", "x".repeat(50_000)), false);
    assert.equal(shouldDistillToolOutput("read_file", "x".repeat(50_000)), false);
  } finally {
    if (prev === undefined) delete process.env.AGENT_DISTILL;
    else process.env.AGENT_DISTILL = prev;
  }
});
