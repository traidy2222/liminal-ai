import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, open } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  selectArtifactJsonView,
  readArtifactJsonView,
  MAX_ARTIFACT_JSON_VIEW_BYTES,
} from "./artifact_json_view.js";
import {
  MAX_ARTIFACT_BYTES,
  writeArtifact,
  artifactPathForHash,
} from "./output_distill.js";
import { runWithWorkspaceRoot } from "./workspace_root.js";

function value(
  raw: string,
  options: Parameters<typeof selectArtifactJsonView>[1],
) {
  const result = selectArtifactJsonView(raw, options);
  assert(result.ok, !result.ok ? result.error : undefined);
  assert(
    Buffer.byteLength(result.output, "utf8") <= MAX_ARTIFACT_JSON_VIEW_BYTES,
  );
  return JSON.parse(result.output);
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-artifact-json-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-artifact-json-"));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20,
    });
  });
  return root;
}

test("minified multi-megabyte archived native results expose actual root keys and bounded nested procedures", async (t) => {
  const root = await fixture(t);
  const procedures = Array.from({ length: 4000 }, (_, i) => ({
    address: `0x${(4096 + i).toString(16)}`,
    name: `procedure_${i}`,
    pseudocode:
      `int fn_${i}() { return ${i}; }\n` +
      "/* measured fixture */\n".repeat(30),
  }));
  const raw = JSON.stringify({
    result: { procedures },
    evidence: { id: "owned-fixture" },
  });
  assert(Buffer.byteLength(raw) > 2_000_000);
  await runWithWorkspaceRoot(root, async () => {
    const file = await writeArtifact("a".repeat(64), raw);
    const keys = await readArtifactJsonView("a".repeat(64), { view: "keys" });
    assert(keys.ok);
    const shape = JSON.parse(keys.output);
    assert.deepEqual(shape.root_keys, ["result", "evidence"]);
    assert.deepEqual(shape.keys, [
      { key: "result", json_pointer: "/result" },
      { key: "evidence", json_pointer: "/evidence" },
    ]);
    const selected = await readArtifactJsonView("a".repeat(64), {
      view: "value",
      jsonPointer: "/result/procedures",
      offset: 20,
      limit: 20,
    });
    assert(selected.ok);
    const page = JSON.parse(selected.output);
    assert.equal(page.selected_count, 20);
    assert.equal(page.next_offset, 40);
    assert.equal(page.total_count, 4000);
    assert.equal(page.value[0].name, "procedure_20");
    assert(Buffer.byteLength(selected.output) <= MAX_ARTIFACT_JSON_VIEW_BYTES);
    assert.equal(
      await readFile(file, "utf8"),
      raw,
      "JSON inspection never rewrites the archived evidence",
    );
  });
});

test("RFC6901 escapes, empty keys and own JSON properties are resolved without prototype traversal", () => {
  const raw = '{"a/b":{"~key":[{"value":"selected"}]},"":{"zero":0}}';
  assert.equal(
    value(raw, { view: "value", jsonPointer: "/a~1b/~0key/0/value" }).value,
    "selected",
  );
  assert.equal(value(raw, { view: "value", jsonPointer: "//zero" }).value, 0);
  assert.equal(
    value('{"__proto__":{"safe":1}}', {
      view: "value",
      jsonPointer: "/__proto__/safe",
    }).value,
    1,
  );
  assert.equal(({} as any).safe, undefined);
  for (const pointer of [
    "/constructor/prototype",
    "/__proto__/polluted",
    "/a~2b",
    "#/a",
    "$..result",
    "/missing",
  ]) {
    const result = selectArtifactJsonView(raw, {
      view: "value",
      jsonPointer: pointer,
    });
    assert.equal(result.ok, false, pointer);
  }
  for (const token of ["01", "-", "-1", "+1", "1e0", "0.0"])
    assert.equal(
      selectArtifactJsonView('["zero"]', {
        view: "value",
        jsonPointer: `/${token}`,
      }).ok,
      false,
      token,
    );
});

test("array pages obey both item and serialized Unicode budgets without skipping items", () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({
    id: i,
    text: `${i}:` + 'emoji🙂 / slash\\"'.repeat(90),
  }));
  const raw = JSON.stringify({ rows });
  let offset = 0,
    pages = 0;
  const collected: unknown[] = [];
  for (;;) {
    const page = value(raw, {
      view: "value",
      jsonPointer: "/rows",
      offset,
      limit: 200,
    });
    assert(page.selected_count > 0 && page.selected_count <= 200);
    collected.push(...page.value);
    pages++;
    if (page.next_offset === null) break;
    assert.equal(page.next_offset, offset + page.selected_count);
    offset = page.next_offset;
    assert(pages < 100);
  }
  assert.deepEqual(collected, rows);
  assert(pages > 1);
  assert.equal(
    selectArtifactJsonView(raw, {
      view: "value",
      jsonPointer: "/rows",
      limit: 201,
    }).ok,
    false,
  );
});

test("oversized first array item returns its exact drill pointer rather than clipping or dropping it", () => {
  const raw = JSON.stringify({
    result: {
      procedures: [
        { name: "large", pseudocode: "x".repeat(50000) },
        { name: "small" },
      ],
    },
  });
  const first = value(raw, {
    view: "value",
    jsonPointer: "/result/procedures",
    limit: 20,
  });
  assert.equal(first.status, "drill_required");
  assert.equal(first.selected_count, 0);
  assert.equal(first.next_offset, 0);
  assert.equal(first.drill_pointer, "/result/procedures/0");
  assert(
    first.drill_keys.some(
      (key: { json_pointer: string }) =>
        key.json_pointer === "/result/procedures/0/pseudocode",
    ),
  );
  assert.equal(first.value, undefined);
  const text = value(raw, {
    view: "value",
    jsonPointer: "/result/procedures/0/pseudocode",
  });
  assert.equal(text.selected_count, 8000);
  assert.equal(text.next_offset, 8000);
  assert.equal(text.value.length, 8000);
});

test("string pages use Unicode code points and useful defaults while fitting escaped UTF8 output", () => {
  const text = '🙂"\\\u0001A'.repeat(5000),
    raw = JSON.stringify({ pseudocode: text });
  let offset = 0,
    joined = "",
    pages = 0;
  for (;;) {
    const page = value(raw, {
      view: "value",
      jsonPointer: "/pseudocode",
      offset,
      limit: 20000,
    });
    assert.equal(page.offset_unit, "unicode_code_points");
    assert.equal(page.selected_count, [...page.value].length);
    assert(page.selected_count > 0);
    joined += page.value;
    pages++;
    if (page.next_offset === null) break;
    assert.equal(page.next_offset, offset + page.selected_count);
    offset = page.next_offset;
    assert(pages < 20);
  }
  assert.equal(joined, text);
  assert.equal(
    value(JSON.stringify({ code: "A".repeat(4000) }), {
      view: "value",
      jsonPointer: "/code",
    }).selected_count,
    4000,
    "normal pseudocode must not require200-character calls",
  );
});

test("keys pagination is bounded and missing paths/bad bounds never substitute a different wrapper", () => {
  const raw = JSON.stringify({ actual: { one: 1, two: 2, three: 3 } });
  const page = value(raw, {
    view: "keys",
    jsonPointer: "/actual",
    offset: 1,
    limit: 1,
  });
  assert.deepEqual(page.keys, [{ key: "two", json_pointer: "/actual/two" }]);
  assert.equal(page.next_offset, 2);
  for (const options of [
    { view: "value", jsonPointer: "/result" },
    { view: "keys", jsonPointer: "/actual/one" },
    { view: "value", jsonPointer: "/actual", offset: 1 },
    { view: "keys", offset: -1 },
    { view: "value", limit: 0 },
    { view: "value", jsonPointer: "x" },
    { view: "value", jsonPointer: null },
    { view: "value", jsonPointer: "/" + "x".repeat(4097) },
  ])
    assert.equal(selectArtifactJsonView(raw, options as any).ok, false);
  assert.equal(selectArtifactJsonView("not json", { view: "value" }).ok, false);
});

test("artifact JSON loading rejects hash traversal and retains the explicit12MB cap", async (t) => {
  const root = await fixture(t);
  await runWithWorkspaceRoot(root, async () => {
    await writeArtifact("deadbeef", '{"owned":true}');
    for (const hash of [
      "../deadbeef",
      "deadbeef.txt",
      "C:\\deadbeef",
      "de/ad",
      "",
      "a".repeat(129),
    ]) {
      const result = await readArtifactJsonView(hash, { view: "keys" });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /invalid hash/);
    }
    await mkdir(path.dirname(artifactPathForHash("bb")), { recursive: true });
    const file = await open(artifactPathForHash("bb"), "wx");
    try {
      await file.truncate(MAX_ARTIFACT_BYTES + 1);
    } finally {
      await file.close();
    }
    const large = await readArtifactJsonView("bb", { view: "keys" });
    assert.equal(large.ok, false);
    if (!large.ok) assert.match(large.error, /12000000-byte load cap/);
  });
});
