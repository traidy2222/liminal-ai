import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentEmitter,
  ToolDispatcher,
  ToolRegistry,
  runWithWorkspaceRoot,
  writeArtifact,
} from "@liminal/core";
import { readArtifactTool } from "./read_artifact.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-json-tool-"));
  const prior = process.env.AGENT_DISTILL;
  process.env.AGENT_DISTILL = "1";
  t.after(async () => {
    if (prior === undefined) delete process.env.AGENT_DISTILL;
    else process.env.AGENT_DISTILL = prior;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-json-tool-"));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20,
    });
  });
  return root;
}

test("legacy hash-only and line-range artifact reads preserve their existing text output", async (t) => {
  const root = await fixture(t);
  await runWithWorkspaceRoot(root, async () => {
    await writeArtifact("aa1234", "one\ntwo\nthree\nfour");
    assert.deepEqual(await readArtifactTool.handler({ hash: "aa1234" }), {
      ok: true,
      output: "one\ntwo\nthree\nfour",
    });
    assert.deepEqual(
      await readArtifactTool.handler({
        hash: "aa1234",
        start_line: 2,
        end_line: 3,
      }),
      { ok: true, output: "two\nthree\n[artifact truncated to lines 2-3]" },
    );
    await writeArtifact("bb1234", "x".repeat(130000));
    const capped = await readArtifactTool.handler({
      hash: "bb1234",
      view: "text",
    });
    assert(capped.ok);
    assert.equal(capped.output, "x".repeat(120000));
  });
});

test("explicit JSON mode pages escaped minified provider values through the actual dispatcher", async (t) => {
  const root = await fixture(t);
  await runWithWorkspaceRoot(root, async () => {
    const procedures = Array.from({ length: 4000 }, (_, i) => ({
      address: i * 4,
      code: `/* ${i} */` + '"\\😀'.repeat(200),
    }));
    const raw = JSON.stringify({
      nativeEvidence: { procedures },
      backend: "fixture",
    });
    assert(Buffer.byteLength(raw) > 2_000_000);
    await writeArtifact("cafe1234", raw);
    const registry = new ToolRegistry();
    registry.register(readArtifactTool);
    registry.activate(["read_artifact"]);
    const dispatcher = new ToolDispatcher(registry, new AgentEmitter());
    const keys = await dispatcher.dispatch(
      "keys",
      "read_artifact",
      JSON.stringify({ hash: "cafe1234", view: "keys" }),
    );
    assert(keys.ok);
    assert.deepEqual(JSON.parse(keys.output).root_keys, [
      "nativeEvidence",
      "backend",
    ]);
    const seen: number[] = [];
    let offset = 0;
    for (let page = 0; page < 2; page++) {
      const selected = await dispatcher.dispatch(
        `page-${page}`,
        "read_artifact",
        JSON.stringify({
          hash: "cafe1234",
          view: "value",
          json_pointer: "/nativeEvidence/procedures",
          offset,
          limit: 200,
        }),
      );
      assert(selected.ok);
      assert(Buffer.byteLength(selected.output) <= 24000);
      assert.doesNotMatch(selected.output, /OUTPUT TRUNCATED/);
      const value = JSON.parse(selected.output);
      assert(value.selected_count > 0 && value.selected_count < 200);
      assert.equal(value.value[0].address, offset * 4);
      seen.push(...value.value.map((row: { address: number }) => row.address));
      assert.equal(value.next_offset, offset + value.selected_count);
      offset = value.next_offset;
    }
    assert.deepEqual(
      seen,
      Array.from({ length: seen.length }, (_, i) => i * 4),
    );
    const missingWrapper = await readArtifactTool.handler({
      hash: "cafe1234",
      view: "value",
      json_pointer: "/result/procedures",
    });
    assert.equal(missingWrapper.ok, false);
  });
});

test("JSON selections infer value mode, reject ambiguous explicit text slices and traversal, and honor cancellation", async (t) => {
  const root = await fixture(t);
  await runWithWorkspaceRoot(root, async () => {
    await writeArtifact("deadbeef", '{"rows":[1,2]}');
    for (const args of [
      { hash: "deadbeef", view: "text", offset: 0 },
      { hash: "deadbeef", view: "value", start_line: 1 },
      { hash: "../deadbeef", view: "keys" },
      { hash: "deadbeef/../../secret", view: "text" },
      {
        hash: "deadbeef",
        view: "value",
        json_pointer: "/constructor/prototype",
      },
    ])
      assert.equal((await readArtifactTool.handler(args)).ok, false);
    const inferred=await readArtifactTool.handler({hash:"deadbeef",json_pointer:"/rows"});assert(inferred.ok);assert.deepEqual(JSON.parse(inferred.output).value,[1,2]);
    const controller = new AbortController();
    controller.abort();
    const stopped = await readArtifactTool.handler(
      { hash: "deadbeef", view: "keys" },
      undefined,
      undefined,
      { signal: controller.signal },
    );
    assert(!stopped.ok);
    assert.match(stopped.error, /turn stopped/);
  });
});


test('previously saved artifacts remain readable when future distillation is disabled',async(t)=>{
 const root=await fixture(t);const prior=process.env.AGENT_TOOL_BODY_ELIDE;t.after(()=>{if(prior===undefined)delete process.env.AGENT_TOOL_BODY_ELIDE;else process.env.AGENT_TOOL_BODY_ELIDE=prior;});
 process.env.AGENT_DISTILL='0';process.env.AGENT_TOOL_BODY_ELIDE='0';
 await runWithWorkspaceRoot(root,async()=>{await writeArtifact('dd1234','{"rows":[1,2]}');const result=await readArtifactTool.handler({hash:'dd1234',json_pointer:'/rows'});assert(result.ok);assert.deepEqual(JSON.parse(result.output).value,[1,2]);});
});
