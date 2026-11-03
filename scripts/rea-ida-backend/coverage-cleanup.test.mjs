import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { isReleasedWorkerRow, transformRunner } from "../repair-rea-ida-backend.mjs";

class AnalysisProtocolError extends Error { _tag = "AnalysisProtocolError"; }
class AnalysisInputError extends Error {
  _tag = "AnalysisInputError";
  constructor(operation, options, issues) { super("Invalid analysis input"); Object.assign(this, { operation, issues }); }
}
class AnalysisCapabilityUnavailableError extends Error {
  _tag = "AnalysisCapabilityUnavailableError";
  constructor(providerId, operation, reason, options) { super(reason); Object.assign(this, { providerId, operation, reason, ...options }); }
}
const fn = { address: "0x401000", name: "start", size: "12" };
const modernLookupSchema = z.array(z.object({ query: z.string(), fn: z.object({ address: z.string(), name: z.string(), size: z.string() }).nullable(), error: z.string().nullable() })).length(1);
const modernDecompileSchema = z.object({ code: z.string().nullable(), error: z.string().optional(), cursor: z.union([z.object({ done: z.literal(true) }), z.object({ next: z.number().int().nonnegative() })]) });

// Minimal original 6.4 runner fixture containing the exact repaired source
// anchors. Schemas above keep real Zod validation ahead of classification.
const runnerSource = `import { AnalysisInputError, AnalysisCancelledError, AnalysisProtocolError, } from "./errors.js";
class FixtureRunner {
    constructor(replies) { this.replies = replies; this.raw = []; }
    async call(tool, args) { const result = this.replies.shift(); this.raw.push({tool, args, result}); return result; }
    async resolve(query) {
            const item = modernLookupSchema.parse(await this.call("lookup_funcs", { queries: [query] }))[0];
            if (item?.fn == null || item.error !== null)
                throw new AnalysisProtocolError(\`IDA function lookup failed for \${query}: \${item?.error ?? "missing function"}\`);
            return item.fn;
    }
    async pseudocode(fn) {
        const result = [];
        let offset = 0;
        while (offset !== null) {
            const page = modernDecompileSchema.parse(await this.call("decompile", { addr: fn.address, offset, max_lines: 100 }));
            if (page.code === null || page.error !== undefined)
                throw new AnalysisProtocolError(\`IDA decompilation failed: \${page.error ?? "missing code"}\`);
            result.push(page.code);
            offset = "next" in page.cursor ? page.cursor.next : null;
        }
        return result.join("\\n");
    }
}`;
function runner(replies, repaired = true) {
  const source = (repaired ? transformRunner(runnerSource) : runnerSource).replace(/^import[^\n]*\n/, "");
  const Fixture = new Function("modernLookupSchema", "modernDecompileSchema", "AnalysisInputError", "AnalysisProtocolError", "AnalysisCapabilityUnavailableError",
    source + "; return FixtureRunner;")(modernLookupSchema, modernDecompileSchema, AnalysisInputError, AnalysisProtocolError, AnalysisCapabilityUnavailableError);
  return new Fixture(replies);
}

test("valid Hex-Rays failure changes opaque protocol failure into precise unavailable coverage without replay", async () => {
  const page = { code: null, error: "decompiler refused at private-producer-context", cursor: { done: true } };
  await assert.rejects(runner([page], false).pseudocode(fn), error => error._tag === "AnalysisProtocolError");
  const fixed = runner([page]);
  await assert.rejects(fixed.pseudocode(fn), error => {
    assert.equal(error._tag, "AnalysisCapabilityUnavailableError"); assert.equal(error.providerId, "ida");
    assert.equal(error.operation, "procedure_pseudo_code"); assert.match(error.userMessage, /Hex-Rays could not decompile this function.*assembly/);
    assert.doesNotMatch(error.message, /private-producer-context/); return true;
  });
  assert.equal(fixed.raw.length, 1); assert.equal(fixed.raw[0].result, page, "retain producer result in the runner's existing raw observations");
});

test("successful paged pseudocode is unchanged; malformed and inconsistent pages remain failures", async () => {
  const fixed = runner([{ code: "first", cursor: { next: 1 } }, { code: "second", cursor: { done: true } }]);
  assert.equal(await fixed.pseudocode(fn), "first\nsecond"); assert.equal(fixed.raw.length, 2);
  for (const page of [
    { code: null, cursor: { done: true } }, { code: null, error: "", cursor: { done: true } },
    { code: "actual code", error: "inconsistent producer", cursor: { done: true } },
    { code: null, error: "not terminal", cursor: { next: 1 } },
  ]) await assert.rejects(runner([page]).pseudocode(fn), error => error._tag === "AnalysisProtocolError");
  for (const page of [{ code: 123, cursor: { done: true } }, { code: null, error: "failed", cursor: { done: false } }])
    await assert.rejects(runner([page]).pseudocode(fn), error => error instanceof z.ZodError);
});

test("only producer-valid explicit not-found lookups become invalid input", async () => {
  for (const message of ["Not found", "Not a function"]) {
    const fixed = runner([[{ query: "missing", fn: null, error: message }]]);
    await assert.rejects(fixed.resolve("missing"), error => {
      assert.equal(error._tag, "AnalysisInputError"); assert.deepEqual(error.issues[0].path, ["procedure"]); return true;
    });
    assert.equal(fixed.raw.length, 1);
  }
  assert.deepEqual(await runner([[{ query: "start", fn, error: null }]]).resolve("start"), fn);
  for (const row of [{ query: "x", fn: null, error: null }, { query: "x", fn: null, error: "backend busy" }, { query: "x", fn, error: "Not found" }])
    await assert.rejects(runner([[row]]).resolve("x"), error => error._tag === "AnalysisProtocolError");
  await assert.rejects(runner([[{ query: "x", error: "Not found" }]]).resolve("x"), error => error instanceof z.ZodError);
});

test("cleanup releases only the exact inactive unowned worker tombstone; all other peer flags block", () => {
  for (const backend of ["worker", "gui"])
    for (const session_id of ["", "owned-session", "peer-session"])
      for (const owned of [false, true])
        for (const is_active of [false, true]) {
          const row = { backend, session_id, owned, is_active, input_path: "/private/input" };
          const expectedReleased = backend === "worker" && session_id === "" && !owned && !is_active;
          assert.equal(isReleasedWorkerRow(row), expectedReleased, JSON.stringify(row));
          const blocks = row.session_id === "owned-session" || (!isReleasedWorkerRow(row) && row.input_path === "/private/input");
          assert.equal(blocks, !expectedReleased, "a live/unowned peer or GUI must retain the workspace");
        }
});
