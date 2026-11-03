import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  ArtifactInvestigationLedger,
  requestedArtifactReports,
} from "./artifact_investigation.js";

async function fixture(t: TestContext, taskId = "fixture-task") {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-investigation-"));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  const ledger = new ArtifactInvestigationLedger({
    workspaceRoot: workspace,
    taskId,
    goal: "Inspect an unfamiliar local archive. Save findings.json and findings.md with observations and unknowns.",
  });
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-investigation-"));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20,
    });
  });
  return { root, workspace, ledger };
}

function readWindow(ledger: ArtifactInvestigationLedger, offset = 0) {
  ledger.observeToolResult({
    name: "read_binary",
    callId: "bytes-" + offset,
    args: { path: "selected.bin", offset },
    result: {
      ok: true,
      output: JSON.stringify({
        path: "selected.bin",
        total_size: 1024,
        offset,
        bytes_read: 32,
        view: "hex",
      }),
    },
  });
}

test("report inference distinguishes existing input reports from explicitly requested output reports", () => {
  assert.deepEqual(
    requestedArtifactReports(
      "Read existing report.json. Write output/findings.json and output/findings.md.",
    ),
    ["output/findings.json", "output/findings.md"],
  );
  assert.deepEqual(
    requestedArtifactReports(
      "Inspect existing metadata.json and explain the bytes.",
    ),
    [],
  );
  assert.deepEqual(
    requestedArtifactReports(
      "Save findings.json and findings.md with precise limits.",
    ),
    ["findings.json", "findings.md"],
  );
});

test("bounded byte evidence persists a resumable incomplete checkpoint without claiming format validation", async (t) => {
  const { ledger } = await fixture(t);
  assert.equal(ledger.checkpointDue(), false);
  readWindow(ledger);
  assert.equal(ledger.checkpointDue(), true);
  const paths = await ledger.persistCheckpoint();
  const saved = JSON.parse(await readFile(paths.jsonPath, "utf8"));
  assert.equal(saved.status, "incomplete");
  assert.equal(saved.semanticCompletion, "unverified");
  assert.deepEqual(
    saved.observations.map(
      (row: { kind: string; offset: number; size: number }) => [
        row.kind,
        row.offset,
        row.size,
      ],
    ),
    [["byte_range", 0, 32]],
  );
  assert(
    saved.reports.reports.every(
      (row: { status: string }) => row.status === "missing",
    ),
  );
  assert.match(
    await readFile(paths.markdownPath, "utf8"),
    /not verified completion|not verified|not.*verified completion/i,
  );
  assert.equal(ledger.checkpointDue(), false);
});

test("renaming successful probe scripts does not count as validated progress and checkpoints stay bounded", async (t) => {
  const { ledger } = await fixture(t);
  readWindow(ledger);
  await ledger.persistCheckpoint();
  for (let i = 0; i < 4; i++)
    ledger.observeToolResult({
      name: "write_file",
      callId: `write-${i}`,
      args: { path: `probe_changed_name_${i}.py` },
      result: { ok: true, output: "Wrote probe source" },
    });
  assert.equal(ledger.checkpointDue(), true);
  assert.equal(
    ledger
      .snapshot()
      .observations.filter((row) => row.kind === "reported_extraction").length,
    0,
  );
  assert.match(
    ledger.formatContextBlock(),
    /Renamed probe scripts are not new structural validation/,
  );
  assert.match(ledger.formatContextBlock(), /before another probe series/);
  for (let i = 0; i < 100; i++) readWindow(ledger, (i % 20) * 32);
  assert(ledger.snapshot().observations.length <= 48);
});

test("claimed report writes cannot satisfy finalization; actual files must parse and remain semantically unassessed", async (t) => {
  const { workspace, ledger } = await fixture(t);
  ledger.observeToolResult({
    name: "write_file",
    args: { path: "findings.json" },
    result: { ok: true, output: "Wrote findings.json" },
  });
  let checked = await ledger.verifyReports();
  assert.equal(checked.allPersistedValid, false);
  assert.match(ledger.finalizationGuidance(checked), /NOT PERSISTED/);
  await writeFile(path.join(workspace, "findings.json"), "{invalid");
  await writeFile(
    path.join(workspace, "findings.md"),
    "# Findings\nOnly a bounded header has been observed; object decoding is unknown.\n",
  );
  checked = await ledger.verifyReports();
  assert.equal(checked.reports[0]?.status, "invalid");
  assert.equal(checked.allPersistedValid, false);
  await writeFile(
    path.join(workspace, "findings.json"),
    JSON.stringify({
      observed: ["header bytes"],
      unknown: ["full object framing"],
      claimed_complete: true,
    }),
  );
  checked = await ledger.verifyReports();
  assert.equal(checked.allPersistedValid, true);
  assert.equal(checked.semanticCompletion, "not_assessed");
  assert.equal(ledger.snapshot().status, "incomplete");
  assert.equal(ledger.finalizationGuidance(checked), "");
});

test("actual persisted parser rejections survive checkpointing and one good extraction does not validate the archive", async (t) => {
  const { workspace, ledger } = await fixture(t);
  await writeFile(
    path.join(workspace, "inventory.json"),
    JSON.stringify({
      entry_count: 4015,
      rejected_count: 374,
      entries: [{ name: "one.good" }],
    }),
  );
  ledger.observeToolResult({
    name: "extract_disc_file",
    args: {},
    result: {
      ok: true,
      output: JSON.stringify({
        destination: "one.good",
        source_offset: 4096,
        size: 128,
        sha256: "a".repeat(64),
      }),
    },
  });
  await ledger.persistCheckpoint();
  const report = ledger.snapshot().coverageReports[0]!;
  assert.equal(report.reportedCounts.rejected_count, 374);
  assert.equal(report.reportedRejections, true);
  assert.equal(
    report.validation,
    "parser_output_only_not_independently_verified",
  );
  assert.match(
    ledger.formatContextBlock(),
    /REJECTED\/UNPARSED RECORDS REMAIN/,
  );
  assert.match(
    ledger.formatContextBlock(),
    /One good extracted record does not validate/,
  );
  assert.equal(ledger.snapshot().status, "incomplete");
});

test("unchanged report hashes cannot reset the probe counter repeatedly", async (t) => {
  const { workspace, ledger } = await fixture(t);
  await writeFile(
    path.join(workspace, "findings.json"),
    '{"observed":"header only"}',
  );
  await writeFile(
    path.join(workspace, "findings.md"),
    "Observed the header only; decoding remains unknown.",
  );
  await ledger.verifyReports();
  for (let i = 0; i < 4; i++)
    ledger.observeToolResult({
      name: "run_shell",
      args: { command: `python renamed_probe_${i}.py` },
      result: { ok: true, output: "probe output" },
    });
  await ledger.verifyReports();
  assert.match(ledger.formatContextBlock(), /probes_since_report_update=4/);
  await writeFile(
    path.join(workspace, "findings.json"),
    '{"observed":"header plus a tested counterexample"}',
  );
  await ledger.verifyReports();
  assert.match(ledger.formatContextBlock(), /probes_since_report_update=0/);
});

test("task identifiers never become paths and checkpoint ancestors cannot escape through junctions", async (t) => {
  const { root, workspace, ledger } = await fixture(
    t,
    "../../external/unsafe-id",
  );
  readWindow(ledger);
  const paths = await ledger.persistCheckpoint();
  assert(!path.relative(workspace, paths.jsonPath).startsWith(".."));
  assert(!paths.jsonPath.includes("unsafe-id"));
  assert.throws(
    () =>
      new ArtifactInvestigationLedger({
        workspaceRoot: workspace,
        taskId: "x".repeat(201),
        goal: "goal",
      }),
    /1\.\.200/,
  );
  const otherWorkspace = path.join(root, "other");
  await mkdir(otherWorkspace);
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    path.join(otherWorkspace, ".agent_artifacts"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const escaping = new ArtifactInvestigationLedger({
    workspaceRoot: otherWorkspace,
    taskId: "blocked",
    goal: "goal",
  });
  readWindow(escaping);
  await assert.rejects(
    escaping.persistCheckpoint(),
    /escapes workspace|symbolic link/,
  );
  assert.deepEqual(await readdir(outside), []);
});

test("report verification rejects outside paths and junctions instead of accepting unrelated findings", async (t) => {
  const { root, workspace } = await fixture(t);
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await writeFile(
    path.join(outside, "findings.json"),
    '{"unrelated":"must not pass"}',
  );
  await symlink(
    outside,
    path.join(workspace, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const ledger = new ArtifactInvestigationLedger({
    workspaceRoot: workspace,
    taskId: "outside-report",
    goal: "goal",
    requiredReports: ["../outside/findings.json", "linked/findings.json"],
  });
  const checked = await ledger.verifyReports();
  assert.equal(checked.allPersistedValid, false);
  assert(checked.reports.every((row) => row.status === "invalid"));
  assert(checked.reports.every((row) => /escapes/.test(row.error ?? "")));
});

test("continued artifact work discovers nearby existing script paths without reading their contents or unrelated trees", async (t) => {
  const { root, workspace } = await fixture(t);
  const game = path.join(root, "selected game"),
    extracted = path.join(game, "extracted");
  await mkdir(path.join(extracted, "tools"), { recursive: true });
  await mkdir(path.join(game, "tools"));
  const artifact = path.join(extracted, "selected.pack");
  await writeFile(artifact, "binary fixture");
  const prior = path.join(game, "tools", "previous_parser.py"),
    local = path.join(extracted, "tools", "inspect.js");
  await writeFile(prior, "SOURCE_CODE_MUST_NOT_APPEAR_IN_CONTEXT");
  await writeFile(local, "ANOTHER_UNTRUSTED_CODE_MARKER");
  await writeFile(path.join(game, "tools", "ignored.log"), "irrelevant");
  await mkdir(path.join(game, "tools", "nested"));
  await writeFile(
    path.join(game, "tools", "nested", "not_recursed.py"),
    "irrelevant",
  );
  await mkdir(path.join(root, "unrelated", "tools"), { recursive: true });
  await writeFile(
    path.join(root, "unrelated", "tools", "unrelated.py"),
    "irrelevant",
  );
  const ledger = new ArtifactInvestigationLedger({
    workspaceRoot: workspace,
    taskId: "prior-work",
    goal: `Continue inspecting "${artifact}". Existing scripts are previous work you may read.`,
    allowExternalSourceDiscovery: true,
  });
  const context = await ledger.discoverPriorWork();
  assert.match(context, /UNTRUSTED PREVIOUS ARTIFACT WORK/);
  assert(context.includes(JSON.stringify(prior)));
  assert(context.includes(JSON.stringify(local)));
  assert.match(context, /verify.*byte ranges/);
  assert.doesNotMatch(
    context,
    /SOURCE_CODE_MUST_NOT|ANOTHER_UNTRUSTED|not_recursed|ignored.log|unrelated.py/,
  );
  const after = path.join(game, "tools", "added_later.py");
  await writeFile(after, "new source");
  assert.equal(
    await ledger.discoverPriorWork(),
    context,
    "a turn reuses its bounded discovery rather than rescanning every round",
  );
});

test("prior-work discovery requires explicit prior/continue context and an existing quoted absolute artifact", async (t) => {
  const { workspace } = await fixture(t);
  await mkdir(path.join(workspace, "tools"));
  await writeFile(path.join(workspace, "tools", "parser.py"), "previous code");
  const artifact = path.join(workspace, "asset.bin");
  await writeFile(artifact, "data");
  for (const goal of [
    `Inspect "${artifact}".`,
    'Continue inspecting "asset.bin" with existing scripts.',
    'Continue investigating "https://example.com/asset.bin".',
    `Do not read existing scripts. Continue inspecting "${artifact}".`,
  ]) {
    const ledger = new ArtifactInvestigationLedger({
      workspaceRoot: workspace,
      taskId: "no-discovery",
      goal,
    });
    assert.equal(await ledger.discoverPriorWork(), "", goal);
  }
});

test("workspace-bound discovery refuses external artifacts and external parent/tools even for an internal artifact", async (t) => {
  const { root, workspace } = await fixture(t);
  const external = path.join(root, "external");
  await mkdir(path.join(external, "tools"), { recursive: true });
  const outsideArtifact = path.join(external, "asset.bin");
  await writeFile(outsideArtifact, "data");
  await writeFile(path.join(external, "tools", "outside.py"), "outside code");
  const refused = new ArtifactInvestigationLedger({
    workspaceRoot: workspace,
    taskId: "external-blocked",
    goal: `Continue "${outsideArtifact}" using previous scripts.`,
    allowExternalSourceDiscovery: false,
  });
  assert.equal(await refused.discoverPriorWork(), "");
  await mkdir(path.join(workspace, "tools"));
  await writeFile(path.join(workspace, "tools", "inside.py"), "inside code");
  await mkdir(path.join(root, "tools"));
  await writeFile(
    path.join(root, "tools", "outside_parent.py"),
    "outside code",
  );
  const insideArtifact = path.join(workspace, "asset.bin");
  await writeFile(insideArtifact, "data");
  const allowed = new ArtifactInvestigationLedger({
    workspaceRoot: workspace,
    taskId: "internal-only",
    goal: `Continue "${insideArtifact}" using existing scripts.`,
    allowExternalSourceDiscovery: false,
  });
  const context = await allowed.discoverPriorWork();
  assert.match(context, /inside.py/);
  assert.doesNotMatch(context, /outside_parent.py|outside.py/);
});

test("source ancestry and tools junctions cannot redirect prior-work discovery outside the selected scope", async (t) => {
  const { root, workspace } = await fixture(t);
  const external = path.join(root, "external");
  await mkdir(external);
  const outsideArtifact = path.join(external, "asset.bin");
  await writeFile(outsideArtifact, "data");
  const unrelated = path.join(root, "unrelated");
  await mkdir(unrelated);
  await writeFile(path.join(unrelated, "escaped.py"), "code");
  await symlink(
    unrelated,
    path.join(external, "tools"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const toolsLink = new ArtifactInvestigationLedger({
    workspaceRoot: workspace,
    taskId: "linked-tools",
    goal: `Continue "${outsideArtifact}" with previous scripts.`,
    allowExternalSourceDiscovery: true,
  });
  assert.equal(await toolsLink.discoverPriorWork(), "");
  await symlink(
    external,
    path.join(workspace, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const sourceLink = new ArtifactInvestigationLedger({
    workspaceRoot: workspace,
    taskId: "linked-source",
    goal: `Continue "${path.join(workspace, "linked", "asset.bin")}" with existing scripts.`,
    allowExternalSourceDiscovery: false,
  });
  assert.equal(await sourceLink.discoverPriorWork(), "");
});

test("discovery caps eligible paths at16 and directory entry reads at64", async (t) => {
  const { workspace } = await fixture(t);
  const game = path.join(workspace, "game"),
    many = path.join(game, "tools");
  await mkdir(many, { recursive: true });
  const artifact = path.join(game, "asset.bin");
  await writeFile(artifact, "data");
  for (let i = 0; i < 20; i++)
    await writeFile(path.join(many, `parser_${i}.py`), "code");
  const capped = new ArtifactInvestigationLedger({
    workspaceRoot: workspace,
    taskId: "file-cap",
    goal: `Continue "${artifact}" with existing scripts.`,
  });
  const context = await capped.discoverPriorWork();
  assert.equal(
    context.split("\n").filter((line) => line.startsWith("- ")).length,
    16,
  );
  for (const name of await readdir(many)) await rm(path.join(many, name));
  for (let i = 0; i < 80; i++)
    await writeFile(path.join(many, `unrelated_${i}.bin`), "not eligible");
  const actualOpendir = fs.promises.opendir;
  let reads = 0;
  t.mock.method(fs.promises, "opendir", async (...args: unknown[]) => {
    const directory = await (actualOpendir as any)(...args);
    const actualRead = directory.read.bind(directory);
    t.mock.method(directory, "read", async () => {
      reads++;
      return actualRead();
    });
    return directory;
  });
  syncBuiltinESMExports();
  try {
    const bounded = new ArtifactInvestigationLedger({
      workspaceRoot: workspace,
      taskId: "entry-cap",
      goal: `Continue "${artifact}" with previous scripts.`,
    });
    assert.equal(await bounded.discoverPriorWork(), "");
    assert.equal(reads, 64);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

function syntheticScene() {
  const line = Buffer.from(
    "NetImmerse File Format, Version 4.2.1.0\n",
    "ascii",
  );
  const fields = Buffer.alloc(12);
  fields.writeUInt32LE(0x04020100, 0);
  fields.writeUInt32LE(9, 4);
  fields.writeUInt32LE(6, 8);
  return Buffer.concat([
    line,
    fields,
    Buffer.from("NiNode"),
    Buffer.alloc(4096),
  ]);
}

test("output headers are discovered in arbitrary first-level artifact folders but never nested or tool-cache folders", async (t) => {
  const { workspace, ledger } = await fixture(t);
  for (const directory of [
    "assets_out",
    "extracted_fresh",
    "nested/deeper",
    "tools",
    ".hidden",
    "node_modules",
  ])
    await mkdir(path.join(workspace, directory), { recursive: true });
  await writeFile(
    path.join(workspace, "assets_out", "scene.ucf"),
    syntheticScene(),
  );
  await writeFile(
    path.join(workspace, "extracted_fresh", "scene.nif"),
    syntheticScene(),
  );
  for (const directory of ["nested/deeper", "tools", ".hidden", "node_modules"])
    await writeFile(
      path.join(workspace, directory, "not_observed.ucf"),
      syntheticScene(),
    );
  await ledger.persistCheckpoint();
  const headers = ledger.snapshot().workspaceBinaryHeaders;
  assert.equal(headers.length, 2);
  assert(headers.some((header) => header.path.includes("assets_out")));
  assert(headers.some((header) => header.path.includes("extracted_fresh")));
  assert(headers.every((header) => !header.path.includes("not_observed")));
});

test("checkpoint observes new extracted binary prefixes proactively and caches unchanged outputs", async (t) => {
  const { workspace, ledger } = await fixture(t);
  await mkdir(path.join(workspace, "extracted"));
  const source = path.join(workspace, "extracted", "character.ucf");
  await writeFile(source, syntheticScene());
  await writeFile(path.join(workspace, "not_binary.py"), syntheticScene());
  const actualOpen = fs.promises.open;
  let binaryOpens = 0,
    readBytes = 0;
  t.mock.method(fs.promises, "open", async (...args: unknown[]) => {
    const file = await (actualOpen as any)(...args);
    if (args[0] === source) {
      binaryOpens++;
      const actualRead = file.read.bind(file);
      t.mock.method(file, "read", async (...readArgs: unknown[]) => {
        const result = await actualRead(...readArgs);
        readBytes += result.bytesRead;
        return result;
      });
    }
    return file;
  });
  syncBuiltinESMExports();
  try {
    const paths = await ledger.persistCheckpoint();
    await ledger.persistCheckpoint();
    assert.equal(binaryOpens, 1);
    assert.equal(readBytes, 256);
    const saved = JSON.parse(await readFile(paths.jsonPath, "utf8"));
    assert.equal(saved.workspaceBinaryHeaders.length, 1);
    const measured = saved.workspaceBinaryHeaders[0];
    assert.equal(measured.prefix_bytes, 256);
    assert.equal(measured.size, syntheticScene().length);
    assert.equal(measured.format_observation.ascii_version, "4.2.1.0");
    assert.equal(
      measured.format_observation.fields.declared_num_blocks.value,
      9,
    );
    assert.equal(measured.format_observation.first_inline_block.type, "NiNode");
    assert.equal(measured.validation, "prefix_only_full_structure_unverified");
    assert.equal(measured.prefix_hex.length, 256);
    assert.match(measured.prefix_sha256, /^[a-f0-9]{64}$/);
    assert.match(ledger.formatContextBlock(), /UNTRUSTED OUTPUT HEADER DATA/);
    assert.match(ledger.formatContextBlock(), /declared_num_blocks/);
    assert.match(ledger.formatContextBlock(), /inline.*not a global/);
    await writeFile(
      source,
      Buffer.concat([syntheticScene(), Buffer.from([1])]),
    );
    await ledger.persistCheckpoint();
    assert.equal(binaryOpens, 2);
    assert.equal(readBytes, 512);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("output header discovery reads at most8 bounded prefixes and follows no extracted-directory junction", async (t) => {
  const { root, workspace, ledger } = await fixture(t);
  await mkdir(path.join(workspace, "extracted"));
  for (let i = 0; i < 10; i++)
    await writeFile(
      path.join(workspace, "extracted", `file_${i}.bin`),
      Buffer.alloc(4096, i),
    );
  const actualOpen = fs.promises.open;
  let reads = 0,
    bytes = 0;
  t.mock.method(fs.promises, "open", async (...args: unknown[]) => {
    const file = await (actualOpen as any)(...args);
    if (String(args[0]).endsWith(".bin")) {
      const actualRead = file.read.bind(file);
      t.mock.method(file, "read", async (...readArgs: unknown[]) => {
        const result = await actualRead(...readArgs);
        reads++;
        bytes += result.bytesRead;
        return result;
      });
    }
    return file;
  });
  syncBuiltinESMExports();
  try {
    await ledger.persistCheckpoint();
    assert.equal(reads, 8);
    assert.equal(bytes, 8 * 256);
    assert.equal(ledger.snapshot().workspaceBinaryHeaders.length, 8);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  const isolated = path.join(root, "isolated"),
    outside = path.join(root, "outside-binaries");
  await mkdir(isolated);
  await mkdir(outside);
  await writeFile(path.join(outside, "not_selected.ucf"), syntheticScene());
  await symlink(
    outside,
    path.join(isolated, "extracted"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const guarded = new ArtifactInvestigationLedger({
    workspaceRoot: isolated,
    taskId: "guarded-headers",
    goal: "Inspect selected output",
  });
  await guarded.persistCheckpoint();
  assert.deepEqual(guarded.snapshot().workspaceBinaryHeaders, []);
});

test("checkpoints preserve small actual hex/u32 samples within the measured byte window", async (t) => {
  const { ledger } = await fixture(t);
  ledger.observeToolResult({
    name: "read_binary",
    args: {},
    result: {
      ok: true,
      output: JSON.stringify({
        path: "scene.bin",
        total_size: 64,
        offset: 0,
        bytes_read: 16,
        view: "u32le",
        words: [
          { offset: 0, value: 0, bytes_hex: "78563412" },
          { offset: 4, value: 0, bytes_hex: "ffffffff" },
          { offset: 1000, bytes_hex: "00000000" },
        ],
      }),
    },
  });
  const paths = await ledger.persistCheckpoint();
  const saved = JSON.parse(await readFile(paths.jsonPath, "utf8"));
  assert.deepEqual(saved.observations[0].byteSamples, [
    { offset: 0, hex: "78563412", unsignedU32LE: 0x12345678 },
    { offset: 4, hex: "ffffffff", unsignedU32LE: 0xffffffff },
  ]);
  assert.match(ledger.formatContextBlock(), /Measured byte samples.*78563412/);
});

test("explicit invalid record flags in actual saved inventories prevent clean-coverage claims", async (t) => {
  const { workspace, ledger } = await fixture(t);
  const entries = Array.from({ length: 4370 }, (_, i) => ({
    name: `record_${i}`,
    in_bounds: i < 1157,
    valid: i < 1157,
  }));
  await writeFile(
    path.join(workspace, "inventory.json"),
    JSON.stringify({ entries }),
  );
  await ledger.persistCheckpoint();
  const observed = ledger.snapshot().coverageReports[0]!;
  assert.equal(observed.reportedCounts.entries_rows_scanned, 4370);
  assert.equal(observed.reportedCounts.entries_in_bounds_true, 1157);
  assert.equal(observed.reportedCounts.entries_in_bounds_false, 3213);
  assert.equal(observed.reportedCounts.entries_valid_false, 3213);
  assert.equal(
    observed.reportedCounts.entries_explicitly_invalid,
    3213,
    "two false flags on one row count as one invalid record",
  );
  assert.equal(observed.reportedRejections, true);
  assert.match(ledger.formatContextBlock(), /3213/);
  assert.match(ledger.formatContextBlock(), /REJECTED\/UNPARSED/);
  assert.match(
    ledger.formatContextBlock(),
    /mixed record variants.*high-bit.*directory.*absolute.*relative/,
  );
});


test("native cleanup tracks only successful executable opens and acknowledged closes", async(t)=>{
  const {ledger}=await fixture(t);
  const emit=(name:string, output:unknown, ok=true)=>ledger.observeToolResult({name,args:{},result:ok?{ok:true,output:JSON.stringify(output)}:{ok:false,error:"provider busy"}});
  emit("mcp_rea_open_binary",{result:{kind:"archive"}});assert.deepEqual(ledger.pendingNativeCleanup(),[]);
  emit("mcp_rea_open_binary",{result:{kind:"executable"}});assert.deepEqual(ledger.pendingNativeCleanup(),["mcp_rea_close_binary"]);
  emit("mcp_rea_close_binary",{result:null},false);assert.equal(ledger.pendingNativeCleanup().length,1);
  emit("mcp_rea_close_binary",{result:{closed:true}});assert.equal(ledger.pendingNativeCleanup().length,1,"unexpected output cannot certify cleanup");
  emit("mcp_rea_close_binary",{result:null});assert.deepEqual(ledger.pendingNativeCleanup(),[]);
  emit("mcp_other_open_binary",{result:{kind:"executable"}});emit("mcp_rea_binary_session",{result:{open:false}});assert.deepEqual(ledger.pendingNativeCleanup(),["mcp_other_close_binary"]);
  emit("mcp_other_binary_session",{result:{open:false}});assert.deepEqual(ledger.pendingNativeCleanup(),["mcp_other_close_binary"],"target closed does not certify worker release");
  emit("mcp_other_close_binary",{result:null});assert.deepEqual(ledger.pendingNativeCleanup(),[]);
});

test("an explicit keep-session-open request is respected, including its negation",async(t)=>{
  const {workspace}=await fixture(t);
  for(const [goal,expected] of [["Inspect sample.bin and keep the analysis session open.",0],["Inspect sample.bin; do not keep the analysis session open.",1]] as const){
    const ledger=new ArtifactInvestigationLedger({workspaceRoot:workspace,taskId:goal,goal});
    ledger.observeToolResult({name:"mcp_rea_open_binary",args:{},result:{ok:true,output:JSON.stringify({result:{kind:"executable"}})}});
    assert.equal(ledger.pendingNativeCleanup().length,expected);
    assert.match(ledger.evidenceReviewGuidance(),/candidate mesh\/skeleton\/animation/);
  }
});


test('absolute and quoted report destinations remain subject to persistence checks',()=>{
 assert.deepEqual(requestedArtifactReports('Save C:/work/findings.json and /work/findings.md.'),['C:/work/findings.json','/work/findings.md']);
 assert.deepEqual(requestedArtifactReports('Write "C:/my work/final.json" and "/my work/final.md".'),['C:/my work/final.json','/my work/final.md']);
 assert.deepEqual(requestedArtifactReports('Read "C:/my work/input.json" and explain it.'),[]);
});


test('a validated archive index becomes an immediate durable milestone before another parser probe',async(t)=>{
 const {ledger}=await fixture(t);const data={format:'recursive_name_table_v1',source:'sample.img',index_sha256:'a'.repeat(64),record_count:4377,file_count:4124,directory_count:253,validation:{index_consumed_exactly:true,file_extents_in_bounds:true,file_extents_sector_aligned:true,file_extents_nonoverlapping:true},inventory_artifact:{path:'inventory-artifact.txt',hash:'b'.repeat(64)},reference_parser_artifact:{path:'reference-artifact.txt',hash:'c'.repeat(64)}};
 ledger.observeToolResult({name:'inspect_binary_archive',args:{},result:{ok:true,output:JSON.stringify(data)}});assert(ledger.checkpointDue());
 const saved=await ledger.persistCheckpoint();const checkpoint=JSON.parse(await readFile(saved.jsonPath,'utf8'));assert.equal(checkpoint.validatedArchiveIndexes[0].record_count,4377);assert.match(ledger.formatContextBlock(),/DO NOT REDISCOVER/);assert.match(ledger.formatContextBlock(),/flat\/length-prefixed/);assert.match(ledger.formatContextBlock(),/Payload structures remain unverified/);
 const {ledger:rejected}=await fixture(t,'rejected');rejected.observeToolResult({name:'inspect_binary_archive',args:{},result:{ok:true,output:JSON.stringify({...data,validation:{...data.validation,file_extents_in_bounds:false}})}});assert.equal(rejected.snapshot().validatedArchiveIndexes.length,0);
});


test('requested JSON cannot contradict an explicitly measured source-bound native entry mapping',async(t)=>{
 const {workspace,ledger}=await fixture(t);const target=path.join(workspace,'boot.elf');const sha='d'.repeat(64);
 ledger.observeToolResult({name:'extract_disc_file',args:{},result:{ok:true,output:JSON.stringify({destination:target,sha256:sha,observations:{native_header:{format:'ELF',status:'observed',source_size:4936852,header_bytes_observed:4096,entry:{mapping_status:'mapped',file_offset:0x15c718,virtual_address:'0x25b718',rva:null,reason:'Measured from PT_LOAD'},coverage:'Header only'}}})}});
 await writeFile(path.join(workspace,'findings.md'),'Header-only observations.');
 await writeFile(path.join(workspace,'findings.json'),JSON.stringify({executable:{sha256:sha,entry_point_file_offset:1402664}}));
 const wrong=await ledger.verifyReports();assert.equal(wrong.allPersistedValid,false);assert.match(wrong.reports[0]!.error!,/1427224.*0x15c718/);
 await writeFile(path.join(workspace,'findings.json'),JSON.stringify({executable:{sha256:sha,entry_point_file_offset:'0x15c718'},unrelated:{sha256:'e'.repeat(64),entry_point_file_offset:42}}));
 assert.equal((await ledger.verifyReports()).allPersistedValid,true);
 assert.match(ledger.formatContextBlock(),/MEASURED NATIVE ENTRY/);assert.match(ledger.evidenceReviewGuidance(),/1427224/);
});


test('an explicitly requested complete inventory may exceed one MiB within the artifact verification cap',async(t)=>{
 const {workspace}=await fixture(t);const ledger=new ArtifactInvestigationLedger({workspaceRoot:workspace,taskId:'large-inventory',goal:'Inspect sample.img and save inventory.json.'});
 await writeFile(path.join(workspace,'inventory.json'),JSON.stringify({entries:Array.from({length:5000},(_,i)=>({path:'nested/'.repeat(30)+i,offset:2048*i,size:100}))}));
 const result=await ledger.verifyReports();assert(result.reports[0]!.bytes!>1024*1024);assert.equal(result.allPersistedValid,true);
});
