/** Live provider smoke test using synthetic workspaces. Uses your configured model/API key.
 * No messages, accounting transactions, commits to your project, or deployments are made.
 * Normal model-provider usage charges apply. Run after npm run build.
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  AgentHarness,
  loadRuntimePreferences,
  resolveProviderConfig,
  runHarnessEffectiveEnvContext,
  runWithWorkspaceRoot,
} from "../packages/core/dist/index.js";
import { readFileTool } from "../packages/tools/dist/families/files/read_file.js";
import { editFileTool } from "../packages/tools/dist/families/files/edit_file.js";
import { runTestsTool } from "../packages/tools/dist/families/code_intel/run_tests.js";
import { gitDiffTool } from "../packages/tools/dist/families/git/git_tools.js";
import { webFetchTool } from "../packages/tools/dist/families/web/web_fetch.js";
import { createWorkPackageTool } from "../packages/tools/dist/families/workflow/work_package.js";
import { createReceiptReadTool } from "../packages/tools/dist/families/workflow/receipt_read.js";
import {
  registerAllTools,
  INCEPTION_MESSAGES,
  buildProtocolDynamicSuffix,
} from "../packages/tools/dist/index.js";
const fullTools = process.argv.includes("--full-tools");
const requested = process.argv.slice(2).filter((k) => k !== "--full-tools");
if (requested.some((k) => !["proposal", "receipt", "patch"].includes(k)))
  throw Error(
    "Usage: npm run verify:workflows:live -- [--full-tools] [proposal receipt patch]",
  );
const original = await loadRuntimePreferences(process.cwd());
const p = structuredClone(original);
p.harness ??= {};
p.harness.env = {
  ...p.harness.env,
  AGENT_WORLD_CONTEXT: "0",
  AGENT_INTENT_INFERENCE: "0",
  AGENT_AUTO_DREAM: "0",
  AGENT_HEARTBEAT: "0",
  AGENT_RECIPE_LIBRARY: "0",
  AGENT_CRITIC: "0",
  AGENT_USER_REPLY_FINALIZE: "0",
  AGENT_RULE_RECALL: "0",
  AGENT_PROACTIVE_VERIFY: "0",
};
const cfg = await runHarnessEffectiveEnvContext(p, () =>
  resolveProviderConfig(),
);
const base = path.resolve(".agent_artifacts/workflows-live-" + Date.now());
await mkdir(base, { recursive: true });
const reports = [];
for (const kind of requested.length
  ? requested
  : ["proposal", "receipt", "patch"]) {
  const root = path.join(base, kind);
  await mkdir(root, { recursive: true });
  const h = new AgentHarness({
    openRouterApiKey: cfg.apiKey,
    baseURL: cfg.baseURL,
    model: cfg.model,
    runtimePreferences: p,
    workspaceRoot: root,
    worldContext: { disabled: true },
    taskId: `workflow-${kind}-${Date.now()}`,
    maxToolRoundsPerTurn: 18,
    maxRetries: 0,
    context: {
      modelMaxTokens: 131072,
      thresholdFraction: 0.8,
      protocolDynamicBuilder: fullTools
        ? (names, hint, registry) =>
            buildProtocolDynamicSuffix(names, hint ?? "any", registry)
        : undefined,
      inceptionMessages: [
        ...(fullTools ? INCEPTION_MESSAGES : []),
        {
          role: "system",
          content:
            "You are Liminal. Execute the guided workflow using the available tools. Follow the required evidence gates. Treat test data as synthetic; do not send or post anything. Make no claims of completion without the work_package result. Use exact file paths supplied by the user.",
        },
      ],
    },
  });
  const tools = [createWorkPackageTool(h)];
  if (kind === "proposal") tools.push(webFetchTool);
  if (kind === "receipt") tools.push(createReceiptReadTool(h));
  if (kind === "patch")
    tools.push(readFileTool, editFileTool, runTestsTool, gitDiffTool);
  if (fullTools) {
    await runWithWorkspaceRoot(root, () =>
      runHarnessEffectiveEnvContext(p, () =>
        registerAllTools(h.registry, h.emitter, h),
      ),
    );
    // Keep the real catalog and production instructions, but bound fixture side effects.
    const allowed = new Set([
      ...tools.map((t) => t.name),
      "activate_tool_family",
      "list_tool_families",
      "think",
      "reason",
      "plan",
      "breakdown",
      "list_dir",
      "grep_file",
      "file_metadata",
    ]);
    const familyMap = h.registry.cloneToolFamilyMap(),
      active = h.registry.getActiveToolNames();
    for (const t of h.registry.getAll())
      if (!allowed.has(t.name)) {
        h.registry.unregister(t.name);
        h.registry.register({
          ...t,
          handler: async () => ({
            ok: false,
            error:
              "This synthetic verification permits only local fixture tools and the supplied research URL. Use work_package and the guided recipe.",
          }),
        });
      }
    h.registry.setToolFamilyLookup(familyMap);
    h.registry.activate(active);
  } else for (const t of tools) h.registry.register(t);
  const calls = [];
  const messages = [];
  h.emitter.on("tool_result", (e) => {
    calls.push({
      name: e.name,
      ...(e.name === "work_package" ? { action: e.args.action } : {}),
      ok: e.result.ok,
      ...(!e.result.ok ? { error: e.result.error.slice(0, 300) } : {}),
    });
    console.log(
      kind +
        " " +
        e.name +
        (e.name === "work_package" ? `(${e.args.action})` : "") +
        " " +
        (e.result.ok ? "ok" : e.result.error.slice(0, 180)),
    );
  });
  h.emitter.on("text", (e) => {
    if (e.channel === "user" || !e.channel) messages.push(e.delta);
  });
  h.emitter.on("error", (e) =>
    console.log(kind + " harness error: " + e.err.message),
  );
  h.emitter.on("tool_approval", (e) => e.resolve({ decision: "reject" }));
  let prompt, options;
  if (kind === "proposal") {
    prompt =
      "Prepare a proposal for fictional client Example Retail: replace their inaccessible contact form with labelled inputs and accessible errors. Scope: one contact page, no payments, no CRM, no deployment. Their indicative budget is AUD 1200, subject to our review; do not promise a delivery date. Research this primary source using web_fetch: https://www.w3.org/WAI/tutorials/forms/ . Save a proposal and an unsent reply draft with work_package; no external communication. All needed context is provided.";
    options = { workflowPreset: "enquiry_to_proposal" };
  }
  if (kind === "receipt") {
    const image = path.join(root, "receipt-demo.png");
    await copyFile(
      "packages/eval/fixtures/signature-workflows/receipt-demo.png",
      image,
    );
    prompt =
      "Prepare a LOCAL expense review from this DEMO receipt. Use receipt_read. Read every amount from the image. No Xero connection or accounting write is requested. After work_package review succeeds, summarize the saved review and stop; do not call complete (which is only for Xero drafts).";
    options = {
      workflowPreset: "receipt_to_xero",
      chatAttachments: [
        {
          name: "receipt-demo.png",
          mimeType: "image/png",
          filePath: image,
          sizeBytes: (await readFile(image)).length,
          source: "file",
        },
      ],
    };
  }
  if (kind === "patch") {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "workflow-demo",
        version: "1.0.0",
        scripts: { test: "node --test regression.test.cjs" },
      }),
    );
    await writeFile(
      path.join(root, "sum.cjs"),
      "exports.sum = (a, b) => a - b;\n",
    );
    await writeFile(
      path.join(root, "regression.test.cjs"),
      "const test=require('node:test');const assert=require('node:assert/strict');const {sum}=require('./sum.cjs');test('sum adds two positive numbers',()=>assert.equal(sum(2,3),5));\n",
    );
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync(
      "git",
      ["add", "package.json", "sum.cjs", "regression.test.cjs"],
      { cwd: root },
    );
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Liminal Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "-qm",
        "Synthetic fixture baseline",
      ],
      { cwd: root },
    );
    prompt = `Bug report for the synthetic project at ${root}: sum(2,3) returns -1, expected 5. Read sum.cjs and regression.test.cjs. First reproduce with run_tests cwd=${root}; then fix sum.cjs using edit_file, run run_tests again, inspect git_diff cwd=${root}, and save the verified handoff with work_package. Run edits and tests sequentially. Do not change the assertion, commit, push, or deploy.`;
    options = { workflowPreset: "bugfix_to_handoff" };
  }
  const started = Date.now();
  await h.send(prompt, options);
  const run = h.signatureWorkflow;
  if (run) await run.deliver("status", {});
  const expected = {
    proposal: "ready_for_review",
    receipt: "ready_for_review",
    patch: "verified_patch",
  }[kind];
  const report = {
    kind,
    model: cfg.model,
    fullTools,
    status: run?.status,
    expected,
    passed: run?.status === expected,
    durationMs: Date.now() - started,
    directory: run?.directory,
    calls,
    answer: messages.join(""),
  };
  try {
    if (!run) throw Error("No saved run");
    assert.equal(run.status, expected);
    if (kind === "proposal") {
      for (const file of [
        "proposal.md",
        "proposal.html",
        "reply-draft.eml",
        "research.json",
      ])
        assert.ok(
          (await readFile(path.join(run.directory, file), "utf8")).length > 40,
          file,
        );
      assert.match(
        await readFile(path.join(run.directory, "reply-draft.eml"), "utf8"),
        /^X-Unsent: 1/,
      );
      const sources = JSON.parse(
        await readFile(path.join(run.directory, "research.json"), "utf8"),
      );
      assert.ok(
        sources.some(
          (s) => s.url === "https://www.w3.org/WAI/tutorials/forms/",
        ),
      );
    }
    if (kind === "receipt") {
      const d = JSON.parse(
        await readFile(path.join(run.directory, "expense-review.json"), "utf8"),
      );
      assert.equal(d.currency, "AUD");
      assert.equal(d.total, 55);
      assert.equal(d.tax, 5);
      assert.equal(d.date, "2026-11-02");
      assert.equal(d.lines[0].quantity, 2);
      assert.equal(d.lines[0].unit_price, 25);
      assert.equal(d.sourceFiles.length, 1);
      assert.ok(calls.some((c) => c.name === "receipt_read" && c.ok));
      assert.ok(
        !calls.some(
          (c) => c.name === "vision_analyze" || c.name.startsWith("xero_"),
        ),
      );
    }
    if (kind === "patch") {
      assert.ok(calls.some((c) => c.name === "run_tests" && !c.ok));
      assert.ok(calls.some((c) => c.name === "run_tests" && c.ok));
      assert.match(
        await readFile(path.join(run.directory, "test-evidence.txt"), "utf8"),
        /# pass 1/,
      );
      assert.match(
        await readFile(path.join(run.directory, "patch.diff"), "utf8"),
        /diff --git a\/sum.cjs/,
      );
      assert.equal(
        execFileSync(
          process.execPath,
          ["-p", "require('./sum.cjs').sum(2,3)"],
          { cwd: root, encoding: "utf8" },
        ).trim(),
        "5",
      );
    }
    const saved = JSON.parse(
      await readFile(path.join(run.directory, "run.json"), "utf8"),
    );
    assert.equal(saved.status, expected);
  } catch (e) {
    report.passed = false;
    report.validationError = e.message;
  }
  reports.push(report);
  await writeFile(
    path.join(root, "live-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      kind,
      status: report.status,
      passed: report.passed,
      durationMs: report.durationMs,
      directory: report.directory,
    }),
  );
}
await writeFile(
  path.join(base, "summary.json"),
  JSON.stringify(reports, null, 2),
);
console.log("Reports: " + base);
process.exit(reports.every((r) => r.passed) ? 0 : 1);
