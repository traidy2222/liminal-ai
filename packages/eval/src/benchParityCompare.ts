#!/usr/bin/env node
/**
 * A/B: same scenario on sandbox lab vs desktop-parity stack.
 * Usage: node --env-file=../../.env --import tsx/esm src/benchParityCompare.ts [scenario-name]
 */
import "./evalWorkspaceBootstrap.js";
process.env["EVAL_SANDBOX_LAB"] = "1";
process.env["EVAL_DESKTOP_PARITY"] = "1";

import { SANDBOX_CAPABILITY_LAB_SCENARIOS } from "./scenarios/sandbox_capability_lab.js";
import { DESKTOP_PARITY_SCENARIOS } from "./scenarios/desktop_parity_lab.js";
import { runDesktopParitySend } from "./desktopParityRunner.js";
import { runSingleHarnessSend } from "./runner.js";
import type { Scenario } from "./runner.js";

const name = process.argv[2] ?? "research-audit";
const sandbox =
  SANDBOX_CAPABILITY_LAB_SCENARIOS.find((s) => s.name.includes(name)) ??
  SANDBOX_CAPABILITY_LAB_SCENARIOS.find((s) => s.name === `sandbox-${name}`);
const desktop =
  DESKTOP_PARITY_SCENARIOS.find((s) => s.name.includes(name)) ??
  DESKTOP_PARITY_SCENARIOS.find((s) => s.name === `desktop-${name}`);

if (!sandbox || !desktop) {
  console.error(`Need paired sandbox + desktop scenarios matching: ${name}`);
  process.exit(1);
}

async function run(label: string, scenario: Scenario) {
  const t0 = Date.now();
  const result =
    scenario.parityProfile === "desktop"
      ? await runDesktopParitySend(scenario, scenario.userMessage)
      : await runSingleHarnessSend(scenario, scenario.userMessage);
  return { label, wallMs: Date.now() - t0, ...result };
}

console.log("\n=== parity compare ===");
console.log("sandbox:", sandbox.name);
console.log("desktop:", desktop.name);
console.log("");

const [lab, parity] = await Promise.all([run("sandbox-lab", sandbox), run("desktop-parity", desktop)]);

for (const r of [lab, parity]) {
  console.log(`--- ${r.label} ---`);
  console.log("wall_ms:", r.wallMs, "harness_ms:", r.durationMs);
  console.log("model:", r.modelSlug ?? r.parityMeta?.model ?? "?");
  if (r.parityMeta) {
    console.log("bridge_frames:", r.parityMeta.bridgeFrames);
    console.log("approval_prompts:", r.parityMeta.approvalPrompts);
  }
  console.log("error:", r.runError ?? "(none)");
  console.log("");
}

console.log(
  "delta_ms:",
  parity.wallMs - lab.wallMs,
  parity.wallMs > lab.wallMs ? "(desktop slower)" : "(desktop faster)"
);
