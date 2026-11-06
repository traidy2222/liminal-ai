import test from "node:test";
import assert from "node:assert/strict";
import { AgentHarness } from "@liminal/core";
import { createProcedureTools } from "./procedure_memory.js";
test("procedure tools retain their owning harness and disabled state", async () => {
  const make = () =>
    new AgentHarness({
      openRouterApiKey: "offline-unused",
      baseURL: "http://127.0.0.1:1",
      model: "offline",
      proceduralMemory: { enabled: false },
    });
  const first = make(),
    second = make();
  (second as any).getProcedureRuntime = async () => ({
    inspect: async () => ({
      procedures: [],
      contracts: [],
      workspace: { id: second.taskId },
    }),
  });
  const a = createProcedureTools(first).find(
      (t) => t.name === "procedure_memory",
    )!,
    b = createProcedureTools(second).find(
      (t) => t.name === "procedure_memory",
    )!;
  const disabled = await a.handler({ action: "list" });
  assert.equal(disabled.ok, false);
  const own = await b.handler({ action: "list" });
  assert(own.ok);
  if (own.ok) assert.equal(JSON.parse(own.output).workspace.id, second.taskId);
  assert.notEqual(first.taskId, second.taskId);
});

function inputFixture(correct = true, active = false) {
  const harness = new AgentHarness({
    openRouterApiKey: "offline-unused",
    baseURL: "http://127.0.0.1:1",
    model: "offline",
    proceduralMemory: { enabled: false },
  });
  const calls: Array<{
    operation: string;
    inputs: unknown;
    explain?: boolean;
  }> = [];
  const parameters = ["slug", "label"];
  const memory = {
    previewContract: async () => ({ sourceHash: "fixture-hash" }),
    inspect: async () => ({
      workspace: { id: harness.taskId },
      contracts: [
        {
          id: "contract",
          sourcePath: "convention.json",
          sourceHash: "fixture-hash",
          body: {
            name: "Register record",
            directory: "records",
            filenameParameter: "slug",
            fields: {
              id: { parameter: "slug" },
              title: { parameter: "label" },
              kind: { constant: "record" },
            },
          },
        },
      ],
      procedures: [
        {
          state: active ? "active" : "retired",
          body: {
            versionId: "version",
            procedureId: "procedure",
            name: "Register record",
            purpose: "Create record",
            verification: { contractId: "contract" },
            parameters: parameters.map((name) => ({ name })),
          },
        },
      ],
    }),
    verify: async (_: string, inputs: unknown) => {
      calls.push({ operation: "verify", inputs });
      return {
        correct,
        runId: "observed-run",
        observations: {
          target: "records/maple.json",
          observations: [
            { check: "record", passed: correct, detail: "fixture" },
          ],
        },
      };
    },
    learn: async (args: any) => {
      calls.push({
        operation: "learn",
        inputs: args.inputs,
        explain: args.explain,
      });
      return {
        body: {
          versionId: "version",
          parameters: parameters.map((name) => ({ name, type: "string" })),
          verification: { contractId: "contract" },
        },
        state: "candidate",
      };
    },
    validate: async (_: string, inputs: unknown) => {
      calls.push({ operation: "validate", inputs });
      return {
        body: {
          versionId: "version",
          parameters: parameters.map((name) => ({ name, type: "string" })),
          verification: { contractId: "contract" },
        },
        state: "active",
      };
    },
    run: async (_: string, inputs: unknown) => {
      calls.push({ operation: "run", inputs });
      return { verified: true };
    },
  };
  (harness as any).getProcedureRuntime = async () => memory;
  for (const tool of createProcedureTools(harness))
    harness.registry.register(tool);
  return { harness, calls, memory };
}

test("default catalog pages compact handles and marks stale contracts without dumping evidence", async () => {
  const { harness, memory } = inputFixture(true, true);
  const original = await memory.inspect();
  const snapshot = {
    ...original,
    contracts: Array.from({ length: 8 }, (_, i) => ({
      ...original.contracts[0]!,
      id: `contract-${i}`,
      sourcePath: `convention-${i}.json`,
    })),
    procedures: Array.from({ length: 8 }, (_, i) => ({
      ...original.procedures[0]!,
      body: {
        ...original.procedures[0]!.body,
        versionId: `version-${i}`,
        evidence: "EVIDENCE_PAYLOAD".repeat(1000),
        provenance: { sourceRunId: "source" },
        dependencies: [{ fingerprint: "FULL_DEPENDENCY_HASH" }],
      },
    })),
  };
  memory.inspect = async () => snapshot;
  (memory as any).previewContract = async (source: string) => ({
    sourceHash: source === "convention-0.json" ? "changed" : "fixture-hash",
  });
  const tool = harness.registry.get("procedure_memory")!;
  const first = await tool.handler({ action: "list" });
  assert(first.ok, JSON.stringify(first));
  if (!first.ok) return;
  const page = JSON.parse(first.output);
  assert.equal(page.contracts.length, 6);
  assert.equal(page.procedures.length, 6);
  assert.equal(page.nextOffset, 6);
  assert.equal(page.contracts[0].verificationAvailable, false);
  assert.equal(page.contracts[1].verificationAvailable, true);
  assert(
    first.output.length < 7000,
    `catalog too large: ${first.output.length}`,
  );
  assert(!first.output.includes("EVIDENCE_PAYLOAD"));
  assert(!first.output.includes("FULL_DEPENDENCY_HASH"));
  assert.equal(page.procedures[0].body.versionId, "version-0");
  assert.deepEqual(page.procedures[0].requiredInputs, ["slug", "label"]);
  const next = await tool.handler({ action: "list", offset: page.nextOffset });
  assert(next.ok);
  if (next.ok) {
    const last = JSON.parse(next.output);
    assert.equal(last.procedures.length, 2);
    assert.equal(last.contracts.length, 2);
    assert.equal(last.nextOffset, null);
  }
  // The source record is preserved for explicit inspection and UI evidence.
  assert((await memory.inspect()).procedures[0]!.body.evidence.length > 10000);
});

test("inspect stays compact while an explicit audit retains full owned evidence", async () => {
  const { harness, memory } = inputFixture(true, true);
  const snapshot = await memory.inspect();
  const version = snapshot.procedures[0]!;
  const expanded = {
    ...version,
    body: {
      ...version.body,
      provenance: { sourceRunId: "source" },
      evidence: "RAW_EVIDENCE".repeat(500),
    },
  };
  memory.inspect = async () => ({ ...snapshot, procedures: [expanded] });
  (memory as any).store = {
    history: () => [{ state: "active" }],
    events: () => [],
    validations: () => [],
  };
  const tool = harness.registry.get("procedure_memory")!;
  const compact = await tool.handler({
    action: "inspect",
    version_id: "version",
  });
  assert(compact.ok, JSON.stringify(compact));
  if (compact.ok) {
    assert(compact.output.length < 1500);
    assert(!compact.output.includes("RAW_EVIDENCE"));
    assert.equal(JSON.parse(compact.output).audit, undefined);
    assert.match(JSON.parse(compact.output).detailsAvailable, /Optional audit/);
  }
  const audit = await tool.handler({ action: "audit", version_id: "version" });
  assert(audit.ok, JSON.stringify(audit));
  if (audit.ok) assert(audit.output.includes("RAW_EVIDENCE"));
  if (audit.ok) {
    let page = JSON.parse(audit.output),
      content = page.content;
    assert(content.length <= 2000);
    while (page.nextOffset !== null) {
      const more = await tool.handler({
        action: "audit",
        version_id: "version",
        offset: page.nextOffset,
      });
      assert(more.ok);
      if (!more.ok) break;
      page = JSON.parse(more.output);
      assert(page.content.length <= 2000);
      content += page.content;
    }
    assert.equal(
      JSON.parse(content).procedure.body.evidence,
      expanded.body.evidence,
    );
  }
  const foreign = await tool.handler({
    action: "audit",
    version_id: "foreign",
  });
  assert(!foreign.ok);
  const missingVersion = await tool.handler({ action: "audit", offset: 2000 });
  assert(!missingVersion.ok);
  if (!missingVersion.ok)
    assert.match(
      missingVersion.error,
      /every audit page needs the same version_id/,
    );
  const wrongPageType = await tool.handler({
    action: "evidence",
    version_id: "version",
    offset: 2000,
  });
  assert(!wrongPageType.ok);
  if (!wrongPageType.ok)
    assert.match(
      wrongPageType.error,
      /Missing event_id.*continue version audit/,
    );
});

test("named inputs pass real dispatcher validation across the entire procedure lifecycle", async () => {
  const { harness, calls } = inputFixture();
  const inputs = [
    { name: "slug", value: "cedar" },
    { name: "label", value: "Cedar" },
  ];
  for (const [tool, args] of [
    ["procedure_verify", { contract_id: "contract", inputs }],
    ["procedure_memory", { action: "learn", contract_id: "contract", inputs }],
    ["procedure_memory", { action: "validate", version_id: "version", inputs }],
    ["procedure_run", { version_id: "version", inputs }],
  ] as const) {
    const result = await harness.dispatcher.dispatch(
      `input-${calls.length}`,
      tool,
      JSON.stringify(args),
    );
    assert(result.ok, JSON.stringify(result));
  }
  assert.deepEqual(
    calls.map((c) => c.operation),
    ["verify", "learn", "validate", "run"],
  );
  assert.equal(calls[1]!.explain, false);
  for (const call of calls)
    assert.deepEqual(
      { ...(call.inputs as object) },
      { slug: "cedar", label: "Cedar" },
    );
  const list = await harness.registry
    .get("procedure_memory")!
    .handler({ action: "list" });
  assert(list.ok);
  if (list.ok) {
    const guide = JSON.parse(list.output);
    assert.deepEqual(guide.contracts[0].requiredInputs, ["slug", "label"]);
    assert.deepEqual(guide.procedures[0].requiredInputs, ["slug", "label"]);
  }
  const legacy = await harness.dispatcher.dispatch(
    "legacy",
    "procedure_verify",
    JSON.stringify({
      contract_id: "contract",
      inputs: { slug: "birch", label: "Birch" },
    }),
  );
  assert(legacy.ok, JSON.stringify(legacy));
  assert.deepEqual(
    { ...(calls.at(-1)!.inputs as object) },
    { slug: "birch", label: "Birch" },
  );
});

test("empty, ambiguous, foreign and malformed inputs fail before any runtime operation", async () => {
  const { harness, calls } = inputFixture();
  for (const inputs of [
    {},
    [],
    null,
    [{ name: "slug", value: "cedar" }],
    [
      { name: "slug", value: "cedar" },
      { name: "slug", value: "birch" },
    ],
    [
      { name: "slug", value: "cedar" },
      { name: "unknown", value: "Cedar" },
    ],
    [
      { name: "slug", value: "../escape" },
      { name: "label", value: "Cedar" },
    ],
    [{ name: "slug", value: "cedar" }, { name: "label" }],
    [
      { name: "slug", value: "cedar" },
      { name: "label", value: 42 },
    ],
    [
      { name: "slug", value: "cedar" },
      { name: "label", value: "Cedar", extra: true },
    ],
  ]) {
    const result = await harness.registry
      .get("procedure_verify")!
      .handler({ contract_id: "contract", inputs });
    assert.equal(result.ok, false, JSON.stringify(inputs));
    if (!result.ok) assert.match(result.error, /slug|name and value/);
  }
  const missing = await harness.registry
    .get("procedure_verify")!
    .handler({ contract_id: "contract", inputs: {} });
  assert(!missing.ok);
  if (!missing.ok)
    assert.match(missing.error, /Missing procedure inputs: slug, label/);
  const foreign = await harness.registry.get("procedure_verify")!.handler({
    contract_id: "another-workspace",
    inputs: { slug: "cedar", label: "Cedar" },
  });
  assert(!foreign.ok);
  assert.equal(calls.length, 0);
});

test("successful results expose complete next arguments; failed verification never suggests learning", async () => {
  const { harness, calls } = inputFixture();
  const verified = await harness.dispatcher.dispatch(
    "receipt",
    "procedure_verify",
    JSON.stringify({
      contract_id: "contract",
      inputs: [
        { name: "slug", value: "maple" },
        { name: "label", value: "Maple" },
      ],
    }),
  );
  assert(verified.ok);
  if (!verified.ok) return;
  const next = JSON.parse(verified.output).nextAction;
  assert.equal(next.arguments.contract_id, "contract");
  assert.equal(next.arguments.run_id, "observed-run");
  const learned = await harness.dispatcher.dispatch(
    "candidate",
    next.tool,
    JSON.stringify(next.arguments),
  );
  assert(learned.ok, JSON.stringify(learned));
  if (!learned.ok) return;
  const validate = JSON.parse(learned.output).nextAction;
  assert.equal(validate.arguments.version_id, "version");
  assert(
    (
      await harness.dispatcher.dispatch(
        "activate",
        validate.tool,
        JSON.stringify(validate.arguments),
      )
    ).ok,
  );
  assert.deepEqual(
    calls.map((c) => c.operation),
    ["verify", "learn", "validate"],
  );
  for (const call of calls)
    assert.deepEqual(
      { ...(call.inputs as object) },
      { slug: "maple", label: "Maple" },
    );
  const failedFixture = inputFixture(false);
  const failed = await failedFixture.harness.registry
    .get("procedure_verify")!
    .handler({
      contract_id: "contract",
      inputs: { slug: "maple", label: "Maple" },
    });
  assert(failed.ok);
  if (failed.ok) assert.equal(JSON.parse(failed.output).nextAction, undefined);
  const activeFixture = inputFixture(true, true);
  const reused = await activeFixture.harness.registry
    .get("procedure_verify")!
    .handler({
      contract_id: "contract",
      inputs: { slug: "maple", label: "Maple" },
    });
  assert(reused.ok, JSON.stringify(reused));
  if (reused.ok)
    assert.equal(
      JSON.parse(reused.output).nextAction,
      undefined,
      "An active procedure must not trigger a new learning suggestion",
    );
});
